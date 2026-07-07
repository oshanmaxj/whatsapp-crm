const { Op, fn, col } = require('sequelize');
const {
  Contact,
  Message,
  WhatsAppComplianceLog,
  WhatsAppTemplate
} = require('../models');

const WINDOW_MS = 24 * 60 * 60 * 1000;

function windowStatus(open) {
  return open ? 'open' : 'closed';
}

class WhatsAppComplianceService {
  async getLastInboundMessage(contactId, whatsappAccountId = null) {
    if (!contactId) return null;
    return Message.findOne({
      where: {
        contactId,
        ...(whatsappAccountId ? { whatsappAccountId } : {}),
        [Op.or]: [
          { direction: 'inbound' },
          { status: 'received' }
        ]
      },
      order: [['created_at', 'DESC']]
    });
  }

  async isConversationWindowOpen(contactId, whatsappAccountId = null) {
    const lastInbound = await this.getLastInboundMessage(contactId, whatsappAccountId);
    if (!lastInbound) return { open: false, lastInboundAt: null };
    const open = Date.now() - new Date(lastInbound.createdAt).getTime() <= WINDOW_MS;
    return { open, lastInboundAt: lastInbound.createdAt };
  }

  async canSendFreeFormMessage(contactId, whatsappAccountId = null) {
    const window = await this.isConversationWindowOpen(contactId, whatsappAccountId);
    return {
      canSend: window.open,
      windowOpen: window.open,
      lastInboundAt: window.lastInboundAt,
      reason: window.open ? '24-hour customer service window is open.' : '24-hour customer service window is closed. Approved template is required.'
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
