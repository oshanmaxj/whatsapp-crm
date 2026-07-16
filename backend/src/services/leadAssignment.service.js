const models = require('../models');
const auditService = require('./audit.service');
const socketService = require('./socket.service');

function fail(code, message, status) {
  return Object.assign(new Error(message), { code, status });
}

function hasPermission(actor, code) {
  return Boolean(actor?.isSystemAdmin || actor?.permissions?.includes(code));
}

function assertPermission({ actor, previousOwnerId, ownerId, source }) {
  if (['automation', 'workflow', 'incoming_whatsapp', 'migration'].includes(source) && !actor) return;
  if (!actor?.id) throw fail('AUTH_REQUIRED', 'Authentication is required.', 401);
  const changed = String(previousOwnerId ?? '') !== String(ownerId ?? '');
  if (!changed || actor.isSystemAdmin) return;
  if (source === 'chat_workspace') {
    if (!previousOwnerId && String(ownerId ?? '') === String(actor.id)
      && hasPermission(actor, 'conversation.claim_unassigned')) return;
    const permission = ownerId == null ? 'conversation.unassign' : 'conversation.reassign';
    if (hasPermission(actor, permission)) return;
    throw fail('REASSIGN_PERMISSION_REQUIRED', 'Conversation reassignment permission is required.', 403);
  }
  const permission = previousOwnerId ? 'lead.reassign' : 'lead.assign';
  if (!hasPermission(actor, permission)) {
    throw fail('LEAD_REASSIGN_FORBIDDEN', 'Lead assignment permission is required.', 403);
  }
}

function displayName(user) {
  return user ? ([user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Unknown') : 'Unassigned';
}

function createLeadAssignmentService(dependencies = {}) {
  const sequelize = dependencies.sequelize || models.sequelize;
  const Lead = dependencies.Lead || models.Lead;
  const Conversation = dependencies.Conversation || models.Conversation;
  const User = dependencies.User || models.User;
  const LeadAssignment = dependencies.LeadAssignment || models.LeadAssignment;
  const LeadActivity = dependencies.LeadActivity || models.LeadActivity;
  const ConversationAssignmentHistory = dependencies.ConversationAssignmentHistory || models.ConversationAssignmentHistory;
  const Message = dependencies.Message || models.Message;
  const audit = dependencies.auditService || auditService;
  const sockets = dependencies.socketService || socketService;

  return {
    async assignAgent({ leadId = null, conversationId = null, ownerId, actor = null, actorUserId = null,
      source = 'leads_page', reason = null, expectedOwnerId, transaction = null }) {
      if (!leadId && !conversationId) throw fail('ASSIGNMENT_TARGET_REQUIRED', 'A lead or conversation is required.', 422);
      const normalizedOwnerId = ownerId === '' || ownerId === undefined ? null : ownerId;
      if (normalizedOwnerId !== null) {
        const assignee = await User.findOne({ where: { id: normalizedOwnerId, status: 'active' }, attributes: ['id'] });
        if (!assignee) throw fail('ASSIGNEE_INVALID', 'Assigned agent not found or inactive.', 422);
      }
      const effectiveActorId = actor?.id || actorUserId || null;

      const run = async (t) => {
        let selectedConversation = null;
        if (conversationId) {
          selectedConversation = await Conversation.findByPk(conversationId, { transaction: t });
          if (!selectedConversation) throw fail('CONVERSATION_NOT_FOUND', 'Conversation not found.', 404);
          leadId = leadId || selectedConversation.leadId;
        }
        const lead = leadId ? await Lead.findByPk(leadId, { transaction: t, lock: t.LOCK.UPDATE }) : null;
        if (leadId && !lead) throw fail('LEAD_NOT_FOUND', 'Lead not found.', 404);

        const conversations = lead
          ? await Conversation.findAll({ where: { leadId: lead.id }, transaction: t, lock: t.LOCK.UPDATE })
          : [await Conversation.findByPk(conversationId, { transaction: t, lock: t.LOCK.UPDATE })];
        if (selectedConversation && !conversations.some((item) => String(item.id) === String(selectedConversation.id))) {
          conversations.push(selectedConversation);
        }
        const previousLeadOwnerId = lead?.ownerId ?? null;
        const previousOwnerId = source === 'chat_workspace' && selectedConversation
          ? selectedConversation.assignedUserId ?? null
          : previousLeadOwnerId ?? selectedConversation?.assignedUserId ?? null;
        if (expectedOwnerId !== undefined && String(expectedOwnerId ?? '') !== String(previousOwnerId ?? '')) {
          throw fail('STALE_ASSIGNMENT_UPDATE', 'Owner changed; reload and try again.', 409);
        }
        assertPermission({ actor, previousOwnerId: previousLeadOwnerId ?? previousOwnerId, ownerId: normalizedOwnerId, source });
        if (['REASSIGNED', 'UNASSIGNED'].includes(previousOwnerId && normalizedOwnerId ? 'REASSIGNED' : previousOwnerId ? 'UNASSIGNED' : '')
          && source === 'chat_workspace' && !String(reason || '').trim()) {
          throw fail('REASSIGN_REASON_REQUIRED', 'A reassignment reason is required.', 422);
        }

        const leadChanged = Boolean(lead) && String(previousLeadOwnerId ?? '') !== String(normalizedOwnerId ?? '');
        const changedConversations = conversations.filter((item) => String(item.assignedUserId ?? '') !== String(normalizedOwnerId ?? ''));
        if (!leadChanged && changedConversations.length === 0) {
          return { lead, conversations, changed: false, previousOwnerId };
        }

        if (leadChanged) await lead.update({ ownerId: normalizedOwnerId }, { transaction: t });
        if (leadChanged && normalizedOwnerId !== null) {
          await LeadAssignment.create({
            leadId: lead.id, assignedTo: normalizedOwnerId, assignedBy: effectiveActorId,
            note: String(reason || (source === 'automation' ? 'Automated assignment' : 'Agent assignment')).slice(0, 255)
          }, { transaction: t });
        }
        if (leadChanged) {
          const activityType = previousLeadOwnerId ? (normalizedOwnerId ? 'LEAD_REASSIGNED' : 'LEAD_UNASSIGNED') : 'LEAD_ASSIGNED';
          await LeadActivity.create({
            leadId: lead.id, actorUserId: effectiveActorId, activityType, action: activityType,
            oldValue: { ownerId: previousLeadOwnerId }, newValue: { ownerId: normalizedOwnerId, source },
            note: String(reason || '').slice(0, 4000) || null
          }, { transaction: t });
        }

        const users = await User.findAll({
          where: { id: [previousOwnerId, normalizedOwnerId, effectiveActorId].filter(Boolean) },
          attributes: ['id', 'firstName', 'lastName', 'email'], transaction: t
        });
        const named = (id) => displayName(users.find((item) => String(item.id) === String(id)));
        for (const conversation of changedConversations) {
          const oldConversationOwnerId = conversation.assignedUserId || null;
          await conversation.update({ assignedUserId: normalizedOwnerId }, { transaction: t });
          const action = oldConversationOwnerId ? (normalizedOwnerId ? 'REASSIGNED' : 'UNASSIGNED') : 'ASSIGNED';
          await ConversationAssignmentHistory.create({
            conversationId: conversation.id, previousUserId: oldConversationOwnerId,
            newUserId: normalizedOwnerId, changedByUserId: effectiveActorId,
            reason: String(reason || '').trim() || null, action
          }, { transaction: t });
          await Message.create({
            conversationId: conversation.id, contactId: conversation.contactId,
            whatsappAccountId: conversation.whatsappAccountId, sentByUserId: effectiveActorId,
            channel: 'system', messageType: 'assignment_event', isInternalNotification: true,
            direction: 'outbound', type: 'text', status: 'sent', statusUpdatedAt: new Date(),
            text: `Conversation ${action.toLowerCase()} from ${named(oldConversationOwnerId)} to ${named(normalizedOwnerId)} by ${named(effectiveActorId)}${reason ? `. Reason: ${reason}` : ''}.`
          }, { transaction: t });
        }
        if (leadChanged) {
          await audit.record({
            userId: effectiveActorId, action: 'LEAD_AGENT_CHANGED', entityType: 'lead', entityId: lead.id,
            changes: { previousOwnerId: previousLeadOwnerId, ownerId: normalizedOwnerId, source, reason: reason || null },
            transaction: t, required: true
          });
        }
        return { lead, conversations, changed: true, previousOwnerId };
      };

      const result = transaction ? await run(transaction) : await sequelize.transaction(run);
      const payload = {
        leadId: result.lead ? String(result.lead.id) : null,
        statusId: result.lead?.statusId || null,
        statusCode: result.lead?.stage || null,
        ownerId: normalizedOwnerId,
        updatedAt: result.lead?.updatedAt || new Date().toISOString(),
        conversationIds: result.conversations.filter(Boolean).map((item) => String(item.id))
      };
      if (result.changed) {
        sockets.emit?.('lead.updated', payload);
        sockets.emit?.('lead.agent.changed', payload);
      }
      return { ...payload, changed: result.changed };
    }
  };
}

const service = createLeadAssignmentService();
module.exports = service;
module.exports.createLeadAssignmentService = createLeadAssignmentService;
