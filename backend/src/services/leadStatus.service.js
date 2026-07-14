const { sequelize, Conversation, Lead, LeadActivity, LeadStatus } = require('../models');
const auditService = require('./audit.service');
const socketService = require('./socket.service');
const { LEAD_STATUS_BY_CODE, normalizeLeadStatusCode } = require('../constants/leadStatuses');

function fail(code, message, status) {
  return Object.assign(new Error(message), { code, status });
}

function canUpdate(actor, lead, source) {
  if (['student_registration', 'student_conversion', 'migration', 'workflow'].includes(source) && !actor) return true;
  if (!actor) return false;
  if (actor.isSystemAdmin || actor.permissions?.includes('lead.update_status_all')) return true;
  return actor.permissions?.includes('lead.update_status_own') && String(lead.ownerId || '') === String(actor.id || '');
}

class LeadStatusService {
  async updateLeadStatus({ leadId, statusCode, actorUserId, actor = null, source = 'leads_page', expectedCurrentStatusCode, transaction = null, auditData = {} }) {
    const code = normalizeLeadStatusCode(statusCode);
    if (!LEAD_STATUS_BY_CODE[code]) throw fail('INVALID_LEAD_STATUS', 'Lead status is invalid.', 422);

    const run = async (t) => {
      const lead = await Lead.findByPk(leadId, {
        include: [{ model: LeadStatus, as: 'status', required: false }],
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (!lead) throw fail('LEAD_NOT_FOUND', 'Lead not found.', 404);
      if (!canUpdate(actor, lead, source)) throw fail('LEAD_STATUS_UPDATE_FORBIDDEN', 'You cannot update this lead status.', 403);

      const currentCode = normalizeLeadStatusCode(lead.status?.code || lead.status?.name || lead.stage);
      if (expectedCurrentStatusCode !== undefined && normalizeLeadStatusCode(expectedCurrentStatusCode) !== currentCode) {
        throw fail('STALE_LEAD_STATUS_UPDATE', 'Lead status changed; reload and try again.', 409);
      }
      const status = await LeadStatus.findOne({ where: { code, active: true }, transaction: t });
      if (!status) throw fail('INVALID_LEAD_STATUS', 'Lead status is not configured.', 422);
      if (currentCode === code && String(lead.statusId) === String(status.id)) return { lead, status, oldStatusCode: currentCode, changed: false };

      const now = new Date();
      const oldStatusId = lead.statusId;
      await lead.update({
        statusId: status.id,
        stage: code,
        ...(code === 'registered' ? { registeredAt: lead.registeredAt || now, convertedAt: lead.convertedAt || now, convertedByUserId: lead.convertedByUserId || actorUserId || null } : {})
      }, { transaction: t });
      await LeadActivity.create({
        leadId: lead.id,
        actorUserId: actorUserId || actor?.id || null,
        action: source === 'student_registration' || source === 'student_conversion' ? 'AUTO_REGISTERED' : 'STATUS_CHANGED',
        oldValue: { statusCode: currentCode, statusId: oldStatusId },
        newValue: { statusCode: code, statusId: status.id, source, ...auditData },
        note: source === 'student_registration' || source === 'student_conversion'
          ? 'Lead automatically marked Registered after student registration.'
          : `Lead status changed from ${currentCode || 'unknown'} to ${code}.`
      }, { transaction: t });
      await auditService.record({
        userId: actorUserId || actor?.id || null,
        action: 'LEAD_STATUS_CHANGED', entityType: 'lead', entityId: lead.id,
        changes: { oldStatus: currentCode, newStatus: code, source, ...auditData }, transaction: t
      });
      return { lead, status, oldStatusCode: currentCode, changed: true };
    };

    const result = transaction ? await run(transaction) : await sequelize.transaction(run);
    if (result.changed) {
      const conversations = await Conversation.findAll({ where: { leadId }, attributes: ['id'] }).catch(() => []);
      await Promise.all(conversations.map((conversation) => socketService.emitToConversationAudience(conversation.id, 'lead:status-updated', {
        leadId: String(leadId), conversationId: String(conversation.id), status: result.status.toJSON()
      })));
    }
    return result;
  }
}

module.exports = new LeadStatusService();
