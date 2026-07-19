const axios = require('axios');
const dns = require('dns').promises;
const net = require('net');
const models = require('../models');
const googleSheetsService = require('./googleSheets.service');
const assignmentService = require('./assignment.service');
const socketService = require('./socket.service');

const ACTION_TYPES = new Set([
  'ADD_LABELS', 'REMOVE_LABELS', 'ADD_TO_LISTS', 'REMOVE_FROM_LISTS',
  'SUBSCRIBE_SEQUENCE', 'UNSUBSCRIBE_SEQUENCE', 'ASSIGN_TEAM', 'ASSIGN_AGENT',
  'AUTO_ASSIGN', 'UNASSIGN_AGENT', 'REMOVE_TEAM', 'SET_CUSTOM_FIELD', 'SEND_WEBHOOK',
  'SEND_GOOGLE_SHEETS', 'CREATE_CALENDAR_EVENT', 'SEND_MESSAGE', 'START_FLOW', 'STOP_FLOW', 'PAUSE_FLOW', 'JUMP_TO_NODE'
]);
const FAILURE_POLICIES = new Set(['CONTINUE', 'STOP_FLOW', 'RETRY', 'ROUTE_TO_ERROR_NODE']);
const SENSITIVE = /token|secret|authorization|password|cookie|api[-_]?key/i;

function render(value, variables = {}) {
  return String(value ?? '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, key) => {
    const found = key.split('.').reduce((current, part) => current?.[part], variables);
    return found == null ? '' : String(found);
  });
}
function sanitize(value, depth = 0) {
  if (depth > 5) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' && value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SENSITIVE.test(key)).map(([key, item]) => [key, sanitize(item, depth + 1)]));
}
function privateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
}
async function safeWebhookUrl(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' || url.username || url.password) throw Object.assign(new Error('Webhook URL must be HTTPS without embedded credentials.'), { code: 'FLOW_WEBHOOK_URL_INVALID' });
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((row) => privateIp(row.address))) throw Object.assign(new Error('Webhook URL resolves to a private or unavailable address.'), { code: 'FLOW_WEBHOOK_SSRF_BLOCKED' });
  return url.toString();
}
function actionIds(config, singular, plural) {
  return [...new Set([...(config[plural] || []), ...(config[singular] == null ? [] : [config[singular]])].map(String).filter(Boolean))];
}

class FlowActionService {
  validateActions(actions = []) {
    const errors = [];
    (Array.isArray(actions) ? actions : []).forEach((action, index) => {
      if (!ACTION_TYPES.has(String(action.actionType || '').toUpperCase())) errors.push({ index, message: 'Unsupported action type.' });
      if (action.failurePolicy && !FAILURE_POLICIES.has(action.failurePolicy)) errors.push({ index, message: 'Unsupported failure policy.' });
      if (String(action.actionType).toUpperCase() === 'SEND_WEBHOOK') {
        try { const url = new URL(action.config?.url); if (url.protocol !== 'https:') throw new Error(); } catch { errors.push({ index, message: 'Webhook action requires an HTTPS URL.' }); }
      }
    });
    return errors;
  }

  async executeOne(type, config, context, transaction) {
    const contactId = context.contactId || context.contact?.id;
    const conversationId = context.conversationId || context.conversation?.id;
    const leadId = context.leadId || context.lead?.id;
    if (type === 'ADD_LABELS' || type === 'REMOVE_LABELS') {
      const labelIds = actionIds(config, 'labelId', 'labelIds');
      if (conversationId && labelIds.length) {
        if (type === 'ADD_LABELS') for (const labelId of labelIds) await models.ConversationLabel.findOrCreate({ where: { conversationId, labelId }, defaults: { conversationId, labelId }, transaction });
        else await models.ConversationLabel.destroy({ where: { conversationId, labelId: { [models.Sequelize?.Op?.in || require('sequelize').Op.in]: labelIds } }, transaction });
      }
      if (contactId && config.names?.length) {
        const contact = await models.Contact.findByPk(contactId, { transaction });
        const current = contact?.tags || [];
        const tags = type === 'ADD_LABELS' ? [...new Set([...current, ...config.names])] : current.filter((tag) => !config.names.includes(tag));
        if (contact) await contact.update({ tags }, { transaction });
      }
      return { labelIds };
    }
    if (type === 'ADD_TO_LISTS' || type === 'REMOVE_FROM_LISTS') {
      const listIds = actionIds(config, 'listId', 'listIds');
      if (type === 'ADD_TO_LISTS') for (const contactListId of listIds) await models.ContactListMember.findOrCreate({ where: { contactListId, contactId }, defaults: { contactListId, contactId, sourceFlowRunId: context.flowRun?.id }, transaction });
      else await models.ContactListMember.destroy({ where: { contactListId: { [require('sequelize').Op.in]: listIds }, contactId }, transaction });
      return { listIds };
    }
    if (type === 'SUBSCRIBE_SEQUENCE') {
      const sequenceIds = actionIds(config, 'sequenceId', 'sequenceIds');
      for (const sequenceId of sequenceIds) {
        const [row, created] = await models.SequenceSubscription.findOrCreate({ where: { sequenceId, contactId }, defaults: { sequenceId, contactId, status: 'active', sourceFlowRunId: context.flowRun?.id, sourceNodeKey: context.nodeKey, sourceButtonId: context.buttonId }, transaction });
        if (!created && row.status !== 'active' && config.restart === true) await row.update({ status: 'active', unsubscribedAt: null, sourceFlowRunId: context.flowRun?.id }, { transaction });
      }
      return { sequenceIds };
    }
    if (type === 'UNSUBSCRIBE_SEQUENCE') {
      const sequenceIds = actionIds(config, 'sequenceId', 'sequenceIds');
      await models.SequenceSubscription.update({ status: 'unsubscribed', unsubscribedAt: new Date() }, { where: { sequenceId: { [require('sequelize').Op.in]: sequenceIds }, contactId, status: 'active' }, transaction });
      return { sequenceIds };
    }
    if (['ASSIGN_TEAM', 'ASSIGN_AGENT', 'AUTO_ASSIGN', 'UNASSIGN_AGENT', 'REMOVE_TEAM'].includes(type)) {
      const conversation = await models.Conversation.findByPk(conversationId, { transaction });
      if (!conversation) throw Object.assign(new Error('Canonical conversation is required for assignment.'), { code: 'FLOW_CONVERSATION_REQUIRED' });
      const previousUserId = conversation.assignedUserId;
      let userId = type === 'ASSIGN_AGENT' ? config.userId : conversation.assignedUserId;
      if (type === 'AUTO_ASSIGN' && leadId) userId = (await assignmentService.assignLead(leadId, context.actor?.userId || null, { note: 'Auto-assigned by flow action' })).assignee?.id || null;
      if (type === 'UNASSIGN_AGENT') userId = null;
      if (userId) {
        const user = await models.User.findByPk(userId, { transaction });
        if (!user || user.status === 'inactive') throw Object.assign(new Error('Selected agent is inactive or unavailable.'), { code: 'FLOW_AGENT_UNAVAILABLE' });
        if (!user.isSystemAdmin && context.whatsappAccountId) {
          const roles = await models.UserRole.findAll({ where: { userId }, attributes: ['roleId'], raw: true, transaction });
          const allowed = roles.length && await models.RoleWhatsAppAccount.count({ where: { roleId: { [require('sequelize').Op.in]: roles.map((row) => row.roleId) }, whatsappAccountId: context.whatsappAccountId }, transaction });
          if (!allowed) throw Object.assign(new Error('Selected agent cannot access this WhatsApp account.'), { code: 'FLOW_AGENT_ACCOUNT_FORBIDDEN' });
        }
      }
      const roleId = type === 'ASSIGN_TEAM' ? config.roleId : type === 'REMOVE_TEAM' ? null : conversation.assignedRoleId;
      if (type === 'ASSIGN_TEAM' && roleId && context.whatsappAccountId) {
        const allowed = await models.RoleWhatsAppAccount.count({ where: { roleId, whatsappAccountId: context.whatsappAccountId }, transaction });
        if (!allowed) throw Object.assign(new Error('Selected team cannot access this WhatsApp account.'), { code: 'FLOW_TEAM_ACCOUNT_FORBIDDEN' });
      }
      if (type === 'ASSIGN_AGENT' && leadId) await assignmentService.assignLead(leadId, context.actor?.userId || null, { assignedTo: userId, note: 'Assigned by flow button action' });
      await conversation.update({ assignedUserId: userId, assignedRoleId: roleId }, { transaction });
      const changedByUserId = context.actor?.userId || previousUserId || userId;
      if (changedByUserId && previousUserId !== userId) await models.ConversationAssignmentHistory.create({ conversationId, previousUserId, newUserId: userId, changedByUserId, reason: 'Flow action', action: userId ? (previousUserId ? 'REASSIGNED' : 'ASSIGNED') : 'UNASSIGNED' }, { transaction });
      if (config.notifyAssignee && userId) await require('./assignmentNotification.service').sendAssignmentNotification({ conversation, assignedUser: await models.User.findByPk(userId), department: roleId ? await models.Role.findByPk(roleId) : null, assignedBy: context.actor?.userId ? await models.User.findByPk(context.actor.userId) : null, assignedUserChanged: previousUserId !== userId, departmentChanged: type === 'ASSIGN_TEAM' });
      return { assignedUserId: userId, assignedRoleId: roleId };
    }
    if (type === 'SET_CUSTOM_FIELD') {
      const entity = config.entity;
      const model = entity === 'lead' ? models.Lead : entity === 'conversation' ? models.Conversation : models.Contact;
      const id = entity === 'lead' ? leadId : entity === 'conversation' ? conversationId : contactId;
      const row = await model.findByPk(id, { transaction });
      if (!row || !/^[a-zA-Z][\w.-]{0,79}$/.test(config.field || '')) throw Object.assign(new Error('Custom field target is invalid.'), { code: 'FLOW_CUSTOM_FIELD_INVALID' });
      const customFields = { ...(row.customFields || {}), [config.field]: render(config.value, context) };
      await row.update({ customFields }, { transaction });
      return { entity, field: config.field };
    }
    if (type === 'SEND_WEBHOOK') {
      const url = await safeWebhookUrl(config.url);
      const allowed = config.fields || ['contact', 'lead', 'conversation', 'variables'];
      const payload = sanitize(Object.fromEntries(allowed.filter((key) => !SENSITIVE.test(key)).map((key) => [key, context[key]])));
      const response = await axios.post(url, payload, { timeout: Math.min(Number(config.timeoutMs) || 10000, 15000), maxRedirects: 0 });
      return { status: response.status };
    }
    if (type === 'SEND_GOOGLE_SHEETS') {
      const values = (config.columns || []).map((column) => render(column.value, context));
      const response = await googleSheetsService.appendRow({ ...config, values });
      return { updatedRange: response.updates?.updatedRange || null };
    }
    if (type === 'CREATE_CALENDAR_EVENT') throw Object.assign(new Error('Google Calendar integration is not configured.'), { code: 'FLOW_CALENDAR_UNAVAILABLE' });
    if (type === 'SEND_MESSAGE') {
      const to = context.contact?.phone || context.phone;
      const response = await require('./whatsapp.service').sendTextMessage({ to, text: render(config.message, context), whatsappAccountId: context.whatsappAccountId, log: true });
      return { whatsappMessageId: response.id || null };
    }
    if (type === 'START_FLOW') return require('./flow.service').startFlowFromAction({ targetFlowId: config.targetFlowId, contactId, conversationId, whatsappAccountId: context.whatsappAccountId, sourceFlowRunId: context.flowRun?.id, sourceNodeId: context.nodeKey, variables: { ...(context.variables || {}), ...(config.variables || {}) }, actorType: context.actor?.type || 'system', transaction });
    if (type === 'STOP_FLOW') return { directive: 'stop' };
    if (type === 'PAUSE_FLOW') return { directive: 'pause', resumeAt: config.resumeAt || null };
    if (type === 'JUMP_TO_NODE') return { directive: 'jump', nodeKey: config.nodeKey };
    return {};
  }

  async executeFlowActions({ actions = [], context, transaction = null, phase = 'pre' }) {
    const ordered = actions.filter((action) => action.enabled !== false && (action.phase || 'pre') === phase).sort((a, b) => Number(a.executionOrder || 0) - Number(b.executionOrder || 0));
    const results = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const action = ordered[index];
      const type = String(action.actionType || '').toUpperCase();
      if (!ACTION_TYPES.has(type)) throw Object.assign(new Error(`Unsupported flow action: ${type}`), { code: 'FLOW_ACTION_INVALID' });
      const key = [context.sourceMessageId || 'manual', context.flowRun?.id || 'no-run', context.nodeKey || 'trigger', context.buttonId || '-', phase, action.id || index, type].join(':');
      const [execution, created] = await models.FlowActionExecution.findOrCreate({ where: { idempotencyKey: key }, defaults: { flowRunId: context.flowRun.id, nodeKey: context.nodeKey || 'trigger', buttonId: context.buttonId || null, actionType: type, phase, idempotencyKey: key, status: 'running', sanitizedInput: sanitize(action.config || {}), startedAt: new Date() }, transaction });
      if (!created && execution.status === 'completed') { results.push({ actionType: type, status: 'duplicate' }); continue; }
      const attempts = action.failurePolicy === 'RETRY' ? Math.min(Number(action.retryPolicy?.maxAttempts) || 2, 3) : 1;
      let failure;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const output = await this.executeOne(type, action.config || {}, context, transaction);
          await execution.update({ status: 'completed', sanitizedOutput: sanitize(output), completedAt: new Date(), errorCode: null, errorMessage: null }, { transaction });
          results.push({ actionType: type, status: 'completed', output });
          if (context.conversationId || context.conversation?.id) {
            await socketService.emitToConversationAudience(context.conversationId || context.conversation.id, 'flow.action.executed', {
              conversationId: context.conversationId || context.conversation.id,
              flowRunId: context.flowRun.id,
              nodeKey: context.nodeKey,
              buttonId: context.buttonId || null,
              actionType: type,
              status: 'completed'
            }).catch(() => null);
          }
          failure = null;
          break;
        } catch (error) { failure = error; }
      }
      if (failure) {
        await execution.update({ status: 'failed', errorCode: failure.code || 'FLOW_ACTION_FAILED', errorMessage: String(failure.message || 'Action failed').slice(0, 1000), completedAt: new Date() }, { transaction });
        results.push({ actionType: type, status: 'failed', errorCode: failure.code || 'FLOW_ACTION_FAILED' });
        if (action.failurePolicy === 'STOP_FLOW') return { results, directive: 'stop' };
        if (action.failurePolicy === 'ROUTE_TO_ERROR_NODE') return { results, directive: 'jump', nodeKey: action.errorNodeKey };
      }
    }
    return { results };
  }
}

module.exports = new FlowActionService();
module.exports.FlowActionService = FlowActionService;
module.exports.sanitize = sanitize;
module.exports.safeWebhookUrl = safeWebhookUrl;
module.exports.ACTION_TYPES = ACTION_TYPES;
