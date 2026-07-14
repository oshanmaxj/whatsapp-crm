const models = require('../models');
const auditService = require('./audit.service');
const socketService = require('./socket.service');
const logger = require('../config/logger');
const { LEAD_STATUS_BY_CODE, normalizeLeadStatusCode } = require('../constants/leadStatuses');

function fail(code, message, status, details) {
  return Object.assign(new Error(message), { code, status, details, exposeMessage: status >= 500 });
}

function canUpdate(actor, lead, source) {
  if (['student_registration', 'student_conversion', 'migration', 'workflow'].includes(source) && !actor) return true;
  if (!actor?.id) return false;
  if (actor.isSystemAdmin || actor.permissions?.includes('lead.update_status_all')) return true;
  return actor.permissions?.includes('lead.update_status_own')
    && String(lead.ownerId || '') === String(actor.id);
}

function publicStatus(status) {
  return { id: status.id, code: status.code, name: status.name };
}

function createLeadStatusService(dependencies = {}) {
  const sequelize = dependencies.sequelize || models.sequelize;
  const Conversation = dependencies.Conversation || models.Conversation;
  const Lead = dependencies.Lead || models.Lead;
  const LeadActivity = dependencies.LeadActivity || models.LeadActivity;
  const LeadStatus = dependencies.LeadStatus || models.LeadStatus;
  const audit = dependencies.auditService || auditService;
  const sockets = dependencies.socketService || socketService;
  const log = dependencies.logger || logger;

  return {
    async updateLeadStatus({ leadId, statusCode, statusId, actorUserId, actor = null, source = 'leads_page', expectedCurrentStatusCode, transaction = null, auditData = {} }) {
      const effectiveActorUserId = actor?.id || actorUserId || null;
      let requestedCode = normalizeLeadStatusCode(statusCode);
      let observedOldStatusCode = null;
      log.info('lead_status_update_attempt', {
        leadId: String(leadId), actorUserId: effectiveActorUserId, newStatusCode: requestedCode || null
      });

      const run = async (t) => {
        // Lock only the lead row. A nullable status include would make PostgreSQL
        // reject FOR UPDATE on the outer-joined lead_status table.
        const lead = await Lead.findByPk(leadId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!lead) throw fail('LEAD_NOT_FOUND', 'Lead not found.', 404);
        if (!canUpdate(actor, lead, source)) {
          throw fail('LEAD_STATUS_UPDATE_FORBIDDEN', 'You cannot update this lead status.', 403);
        }

        const currentStatus = await LeadStatus.findByPk(lead.statusId, { transaction: t });
        const currentCode = normalizeLeadStatusCode(currentStatus?.code || currentStatus?.name || lead.stage);
        observedOldStatusCode = currentCode;
        if (expectedCurrentStatusCode !== undefined
          && normalizeLeadStatusCode(expectedCurrentStatusCode) !== currentCode) {
          throw fail('STALE_LEAD_STATUS_UPDATE', 'Lead status changed; reload and try again.', 409);
        }

        let status = null;
        if (LEAD_STATUS_BY_CODE[requestedCode]) {
          status = await LeadStatus.findOne({ where: { code: requestedCode, active: true }, transaction: t });
        } else if (statusId !== undefined && statusId !== null && String(statusId).trim()) {
          const byId = await LeadStatus.findByPk(statusId, { transaction: t });
          requestedCode = normalizeLeadStatusCode(byId?.code);
          if (byId?.active && LEAD_STATUS_BY_CODE[requestedCode]) status = byId;
        }
        if (!LEAD_STATUS_BY_CODE[requestedCode]) {
          throw fail('INVALID_LEAD_STATUS', 'Lead status is invalid.', 400);
        }
        if (!status) {
          throw fail('INVALID_LEAD_STATUS', 'Lead status is not configured.', 400);
        }

        log.info('lead_status_update_resolved', {
          leadId: String(leadId), actorUserId: effectiveActorUserId,
          oldStatusCode: currentCode, newStatusCode: requestedCode, statusId: status.id
        });

        if (currentCode === requestedCode && String(lead.statusId) === String(status.id)) {
          return { lead, status, oldStatusCode: currentCode, changed: false };
        }

        const now = new Date();
        const oldStatusId = lead.statusId;
        await lead.update({
          statusId: status.id,
          stage: requestedCode,
          ...(requestedCode === 'registered' ? {
            convertedAt: lead.convertedAt || now,
            convertedByUserId: lead.convertedByUserId || effectiveActorUserId
          } : {})
        }, { transaction: t });
        log.info('lead_status_update_saved', {
          leadId: String(leadId), actorUserId: effectiveActorUserId,
          oldStatusCode: currentCode, newStatusCode: requestedCode
        });

        try {
          await LeadActivity.create({
            leadId: lead.id,
            actorUserId: effectiveActorUserId,
            action: source === 'student_registration' || source === 'student_conversion' ? 'AUTO_REGISTERED' : 'STATUS_CHANGED',
            oldValue: { statusCode: currentCode, statusId: oldStatusId },
            newValue: { statusCode: requestedCode, statusId: status.id, source, ...auditData },
            note: source === 'student_registration' || source === 'student_conversion'
              ? 'Lead automatically marked Registered after student registration.'
              : `Lead status changed from ${currentCode || 'unknown'} to ${requestedCode}.`
          }, { transaction: t });
          log.info('lead_status_activity_saved', {
            leadId: String(leadId), actorUserId: effectiveActorUserId,
            oldStatusCode: currentCode, newStatusCode: requestedCode
          });
        } catch (error) {
          throw fail('LEAD_STATUS_ACTIVITY_FAILED', 'Failed to save lead status history.', 500, {
            causeCode: error.code || error.name
          });
        }

        try {
          await audit.record({
            userId: effectiveActorUserId,
            action: 'LEAD_STATUS_CHANGED', entityType: 'lead', entityId: lead.id,
            changes: { oldStatus: currentCode, newStatus: requestedCode, source, ...auditData },
            transaction: t, required: true
          });
        } catch (error) {
          throw fail('LEAD_STATUS_AUDIT_FAILED', 'Failed to save lead status audit log.', 500, {
            causeCode: error.code || error.name
          });
        }
        return { lead, status, oldStatusCode: currentCode, changed: true };
      };

      try {
        const result = transaction ? await run(transaction) : await sequelize.transaction(run);
        if (result.changed) {
          const conversations = await Conversation.findAll({ where: { leadId }, attributes: ['id'] }).catch(() => []);
          const emissions = await Promise.allSettled(conversations.map((conversation) => (
            sockets.emitToConversationAudience(conversation.id, 'lead:status-updated', {
              leadId: String(leadId), conversationId: String(conversation.id), status: publicStatus(result.status)
            })
          )));
          if (emissions.some((item) => item.status === 'rejected')) {
            log.warn('lead_status_socket_emit_failed', { leadId: String(leadId), actorUserId: effectiveActorUserId });
          }
        }
        return {
          id: result.lead.id,
          statusId: result.status.id,
          status: publicStatus(result.status)
        };
      } catch (error) {
        log.error('lead_status_update_failed', {
          leadId: String(leadId), actorUserId: effectiveActorUserId,
          oldStatusCode: observedOldStatusCode, newStatusCode: requestedCode || null,
          error: { name: error.name, code: error.code, message: error.message }
        });
        throw error;
      }
    }
  };
}

const service = createLeadStatusService();
module.exports = service;
module.exports.createLeadStatusService = createLeadStatusService;
module.exports.canUpdate = canUpdate;
