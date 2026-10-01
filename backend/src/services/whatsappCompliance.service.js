const { Op, fn, col, QueryTypes } = require('sequelize');
const {
  sequelize,
  Contact,
  Message,
  WhatsAppComplianceLog,
  WhatsAppTemplate
} = require('../models');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const messagingWindowService = require('./messagingWindow.service');
const { FREE_ENTRY_WINDOW_MS, QUALIFYING_RESPONSE_DEADLINE_MS } = messagingWindowService;

// Builds the account-scope SQL fragment + bind parameters shared by every
// query below, matching report()'s existing filter convention exactly:
// filters.whatsappAccountId (one specific number) takes precedence; failing
// that, filters._accessibleAccountIds (the caller's full authorized set, or
// null for a truly unrestricted admin) scopes it; both ultimately resolve
// to the same whatsappAccountAccessService the rest of the app already uses
// — this function never re-derives access on its own.
function accountScope(filters = {}, column = 'whatsapp_account_id') {
  if (filters.whatsappAccountId) return { sql: `AND ${column} = :whatsappAccountId`, params: { whatsappAccountId: Number(filters.whatsappAccountId) } };
  if (Array.isArray(filters._accessibleAccountIds)) {
    const accountIds = filters._accessibleAccountIds.map(Number).filter(Number.isFinite);
    if (!accountIds.length) return { sql: `AND ${column} = -1`, params: {} }; // no accessible accounts: match nothing
    return { sql: `AND ${column} = ANY(:accountIds::bigint[])`, params: { accountIds } };
  }
  return { sql: '', params: {} }; // unrestricted admin, no account filter
}

function windowStatus(open) {
  return open ? 'open' : 'closed';
}

class WhatsAppComplianceService {
  async getLastInboundMessage(contactId, whatsappAccountId = null, conversationId = null) {
    if (!contactId) return null;
    return Message.findOne({
      where: {
        contactId,
        ...(whatsappAccountId ? { whatsappAccountId } : {}),
        ...(conversationId ? { conversationId } : {}),
        [Op.or]: [
          { direction: 'inbound' },
          { status: 'received' }
        ]
      },
      order: [['created_at', 'DESC']]
    });
  }

  async isConversationWindowOpen(contactId, whatsappAccountId = null, conversationId = null) {
    if (conversationId && whatsappAccountId) {
      const window = await messagingWindowService.getMessagingWindow(conversationId, whatsappAccountId);
      return { open: window.isOpen, lastInboundAt: window.openedAt, messagingWindow: window };
    }
    const lastInbound = await this.getLastInboundMessage(contactId, whatsappAccountId, conversationId);
    if (!lastInbound) return { open: false, lastInboundAt: null };
    const open = Date.now() - new Date(lastInbound.createdAt).getTime() <= WINDOW_MS;
    return { open, lastInboundAt: lastInbound.createdAt };
  }

  async canSendFreeFormMessage(contactId, whatsappAccountId = null, conversationId = null) {
    const window = await this.isConversationWindowOpen(contactId, whatsappAccountId, conversationId);
    return {
      canSend: window.open,
      windowOpen: window.open,
      lastInboundAt: window.lastInboundAt,
      reason: window.open ? '24-hour customer service window is open.' : '24-hour customer service window is closed. Approved template is required.',
      messagingWindow: window.messagingWindow || null
    };
  }

  async getRequiredMessageType(contactId) {
    const result = await this.canSendFreeFormMessage(contactId);
    return result.canSend ? 'free_form' : 'template';
  }

  async validateTemplateUsage({ contactId, templateId, templateName, messageType, whatsappAccountId = null } = {}) {
    const window = await this.isConversationWindowOpen(contactId, whatsappAccountId);
    const requiredMessageType = window.open ? 'free_form' : 'template';
    let allowed = true;
    let reason = 'Free-form message allowed inside 24-hour window.';
    let template = null;

    if (messageType === 'free_form' && !window.open) {
      allowed = false;
      reason = 'Free-form message blocked because the 24-hour window is closed.';
    }

    if (messageType === 'template' || requiredMessageType === 'template') {
      template = templateId
        ? await WhatsAppTemplate.findByPk(templateId)
        : await WhatsAppTemplate.findOne({ where: { name: templateName || '', status: 'APPROVED', ...(whatsappAccountId ? { whatsappAccountId } : {}) } });
      if (!template) {
        allowed = false;
        reason = 'Approved WhatsApp template is required.';
      } else if (template.status !== 'APPROVED') {
        allowed = false;
        reason = `Template status is ${template.status}; APPROVED is required.`;
      } else {
        allowed = true;
        reason = 'Approved template usage allowed.';
      }
    }

    await WhatsAppComplianceLog.create({
      contactId: contactId || null,
      messageType: messageType || requiredMessageType,
      windowStatus: contactId ? windowStatus(window.open) : 'unknown',
      templateId: template?.id || templateId || null,
      allowed,
      reason
      , whatsappAccountId
    });

    return {
      allowed,
      reason,
      windowOpen: window.open,
      windowStatus: contactId ? windowStatus(window.open) : 'unknown',
      requiredMessageType,
      approvedTemplateRequired: requiredMessageType === 'template',
      template
    };
  }

  async messageCheck({ contactId }) {
    const contact = contactId ? await Contact.findByPk(contactId) : null;
    if (!contact) throw Object.assign(new Error('Contact not found'), { status: 404 });
    const freeForm = await this.canSendFreeFormMessage(contactId);
    return {
      contactId,
      canSend: freeForm.canSend,
      windowOpen: freeForm.windowOpen,
      requiredMessageType: freeForm.canSend ? 'free_form' : 'template',
      approvedTemplateRequired: !freeForm.canSend,
      reason: freeForm.reason,
      lastInboundAt: freeForm.lastInboundAt
    };
  }

  async status() {
    const [approved, pending, rejected, qualityRows, recentLogs] = await Promise.all([
      WhatsAppTemplate.count({ where: { status: 'APPROVED' } }),
      WhatsAppTemplate.count({ where: { status: 'PENDING' } }),
      WhatsAppTemplate.count({ where: { status: 'REJECTED' } }),
      WhatsAppTemplate.findAll({
        attributes: ['qualityRating', [fn('count', col('id')), 'count']],
        group: ['qualityRating'],
        raw: true
      }),
      WhatsAppComplianceLog.findAll({
        include: [{ model: Contact, as: 'contact', attributes: ['id', 'firstName', 'lastName', 'phone'] }, { model: WhatsAppTemplate, as: 'template' }],
        order: [['created_at', 'DESC']],
        limit: 100
      })
    ]);
    const openWindows = await Message.count({
      where: {
        direction: 'inbound',
        createdAt: { [Op.gte]: new Date(Date.now() - WINDOW_MS) }
      },
      distinct: true,
      col: 'contact_id'
    });
    return {
      conversationWindowStatus: { openContacts: openWindows },
      approvedTemplates: approved,
      pendingTemplates: pending,
      rejectedTemplates: rejected,
      qualityRatings: qualityRows.map((row) => ({ rating: row.qualityRating, count: Number(row.count || 0) })),
      logs: recentLogs
    };
  }

  // The canonical window dashboard: 24-hour Customer Service Window and
  // 72-hour Free Entry Point stats, kept strictly separate per Part 5's
  // requirement, computed from the same canonical Message/Conversation rows
  // messagingWindow.service.js already uses for single-conversation checks —
  // never a parallel/competing calculation. Every count here is one indexed
  // aggregate query (no N+1, no per-conversation recalculation in JS).
  async windowDashboard(filters = {}) {
    const scope = accountScope(filters, 'm.whatsapp_account_id');
    const convoScope = accountScope(filters, 'c.whatsapp_account_id');

    // One CTE pipeline, reused by every 72h query below, so the "which
    // conversations have a verified free-entry window, and when" logic is
    // computed exactly once and never duplicated across queries.
    const freeEntryCte = `
      WITH referral_entries AS (
        SELECT DISTINCT ON (m.conversation_id) m.conversation_id, m.created_at AS referral_at
        FROM messages m
        WHERE m.direction = 'inbound' AND m.deleted_at IS NULL AND m.channel = 'whatsapp'
          AND (m.referral_source_type IS NOT NULL OR m.ctwa_clid IS NOT NULL)
          ${scope.sql}
        ORDER BY m.conversation_id, m.created_at DESC
      ),
      qualifying_responses AS (
        SELECT re.conversation_id, re.referral_at,
          (SELECT MIN(r.created_at) FROM messages r
           WHERE r.conversation_id = re.conversation_id AND r.direction = 'outbound' AND r.deleted_at IS NULL
             AND r.created_at > re.referral_at) AS response_at
        FROM referral_entries re
      ),
      free_entry_windows AS (
        SELECT conversation_id, referral_at, response_at,
          (response_at IS NOT NULL AND response_at <= referral_at + INTERVAL '${QUALIFYING_RESPONSE_DEADLINE_MS} milliseconds') AS qualified,
          (response_at + INTERVAL '${FREE_ENTRY_WINDOW_MS} milliseconds') AS expires_at
        FROM qualifying_responses
      )
    `;

    const [serviceWindowConversations, freeEntryConversations, serviceWindowMessages, freeEntryMessages, pricing, uniqueActiveContacts] = await Promise.all([
      // 24H conversation active/expired, by latest inbound message per conversation.
      sequelize.query(`
        WITH latest_inbound AS (
          SELECT m.conversation_id, MAX(m.created_at) AS last_inbound_at
          FROM messages m
          WHERE m.direction = 'inbound' AND m.deleted_at IS NULL AND m.channel = 'whatsapp' ${scope.sql}
          GROUP BY m.conversation_id
        )
        SELECT
          COUNT(*) FILTER (WHERE last_inbound_at > NOW() - INTERVAL '${WINDOW_MS} milliseconds') AS active,
          COUNT(*) FILTER (WHERE last_inbound_at <= NOW() - INTERVAL '${WINDOW_MS} milliseconds') AS expired
        FROM latest_inbound
      `, { replacements: scope.params, type: QueryTypes.SELECT }),

      // 72H conversation active/expired, from the shared CTE pipeline.
      sequelize.query(`${freeEntryCte}
        SELECT
          COUNT(*) FILTER (WHERE qualified AND expires_at > NOW()) AS active,
          COUNT(*) FILTER (WHERE qualified AND expires_at <= NOW()) AS expired
        FROM free_entry_windows
      `, { replacements: scope.params, type: QueryTypes.SELECT }),

      // 24H message stats: an outbound message counts as "inside the 24H
      // window" when a qualifying inbound message preceded it by <=24h —
      // evaluated at THAT message's own send time, not "now".
      sequelize.query(`
        SELECT m.status, COUNT(*) AS count
        FROM messages m
        WHERE m.direction = 'outbound' AND m.deleted_at IS NULL AND m.channel = 'whatsapp' ${scope.sql}
          AND EXISTS (
            SELECT 1 FROM messages inb
            WHERE inb.conversation_id = m.conversation_id AND inb.direction = 'inbound' AND inb.deleted_at IS NULL
              AND inb.created_at <= m.created_at
              AND inb.created_at > m.created_at - INTERVAL '${WINDOW_MS} milliseconds'
          )
        GROUP BY m.status
      `, { replacements: scope.params, type: QueryTypes.SELECT }),

      // 72H message stats: an outbound message counts only when it falls
      // inside its conversation's own VERIFIED (qualified) free-entry window.
      sequelize.query(`${freeEntryCte}
        SELECT m.status, COUNT(*) AS count
        FROM messages m
        JOIN free_entry_windows few ON few.conversation_id = m.conversation_id AND few.qualified
        WHERE m.direction = 'outbound' AND m.deleted_at IS NULL AND m.channel = 'whatsapp'
          AND m.created_at >= few.response_at AND m.created_at < few.expires_at
        GROUP BY m.status
      `, { replacements: scope.params, type: QueryTypes.SELECT }),

      // Billing/pricing classification (Part 9): confirmed from Meta's own
      // webhook pricing object only — never inferred from window status.
      sequelize.query(`
        SELECT
          COUNT(*) FILTER (WHERE pricing_billable = false) AS confirmed_free,
          COUNT(*) FILTER (WHERE pricing_billable = true) AS confirmed_billable,
          COUNT(*) FILTER (WHERE pricing_billable IS NULL) AS unknown
        FROM messages m
        WHERE m.direction = 'outbound' AND m.deleted_at IS NULL AND m.channel = 'whatsapp' ${scope.sql}
      `, { replacements: scope.params, type: QueryTypes.SELECT }),

      // Deduplicated total (Part 5): a contact with both windows active is
      // counted once, never added into a combined 24h+72h sum.
      sequelize.query(`${freeEntryCte}
        SELECT COUNT(DISTINCT c.contact_id) AS count
        FROM conversations c
        WHERE c.deleted_at IS NULL ${convoScope.sql} AND (
          EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'inbound' AND m.deleted_at IS NULL AND m.created_at > NOW() - INTERVAL '${WINDOW_MS} milliseconds')
          OR c.id IN (SELECT conversation_id FROM free_entry_windows WHERE qualified AND expires_at > NOW())
        )
      `, { replacements: { ...scope.params, ...convoScope.params }, type: QueryTypes.SELECT })
    ]);

    const messageCounts = (rows) => {
      const byStatus = Object.fromEntries(rows.map((row) => [row.status, Number(row.count || 0)]));
      return {
        sent: Object.values(byStatus).reduce((sum, n) => sum + n, 0),
        delivered: byStatus.delivered || 0,
        read: byStatus.read || 0,
        failed: byStatus.failed || 0
      };
    };

    return {
      scope: filters.whatsappAccountId ? 'account' : (filters._accessibleAccountIds === null ? 'all' : 'accessible'),
      serviceWindow24h: {
        label: '24-Hour Customer Service Window',
        activeConversations: Number(serviceWindowConversations[0]?.active || 0),
        expiredConversations: Number(serviceWindowConversations[0]?.expired || 0),
        unit: { conversations: 'unique conversations', messages: 'individual messages' },
        messages: messageCounts(serviceWindowMessages)
      },
      freeEntryWindow72h: {
        label: '72-Hour Free Entry Point Window',
        activeConversations: Number(freeEntryConversations[0]?.active || 0),
        expiredConversations: Number(freeEntryConversations[0]?.expired || 0),
        unit: { conversations: 'unique conversations', messages: 'individual messages' },
        messages: messageCounts(freeEntryMessages)
      },
      // Explicitly NOT the sum of the two active-conversation counts above —
      // a conversation/contact with both windows active is counted once here.
      uniqueActiveCustomers: Number(uniqueActiveContacts[0]?.count || 0),
      pricing: {
        label: 'Billing/pricing classification (outbound messages)',
        confirmedFree: Number(pricing[0]?.confirmed_free || 0),
        confirmedBillable: Number(pricing[0]?.confirmed_billable || 0),
        unknown: Number(pricing[0]?.unknown || 0)
      }
    };
  }

  async report(filters = {}) {
    const where = {};
    if (filters.whatsappAccountId) where.whatsappAccountId = filters.whatsappAccountId;
    else if (filters._accessibleAccountIds !== null && filters._accessibleAccountIds !== undefined) {
      where.whatsappAccountId = { [Op.in]: filters._accessibleAccountIds };
    }
    if (filters.fromDate || filters.toDate) {
      where.createdAt = {};
      if (filters.fromDate) where.createdAt[Op.gte] = new Date(filters.fromDate);
      if (filters.toDate) where.createdAt[Op.lte] = new Date(`${filters.toDate}T23:59:59.999Z`);
    }
    const logs = await WhatsAppComplianceLog.findAll({ where, order: [['created_at', 'DESC']], limit: 1000 });
    return {
      messagesSent: logs.filter((row) => row.allowed).length,
      templateMessages: logs.filter((row) => row.messageType === 'template').length,
      freeFormMessages: logs.filter((row) => row.messageType === 'free_form').length,
      violationsPrevented: logs.filter((row) => !row.allowed).length,
      logs
    };
  }
}

module.exports = new WhatsAppComplianceService();
