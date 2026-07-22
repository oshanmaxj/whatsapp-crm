const { Op, fn, col } = require('sequelize');
const models = require('../models');
const routingService = require('./whatsappLeadRouting.service');
const accountAccess = require('./whatsappAccountAccess.service');

const STRATEGIES = new Set(['round_robin','least_open_chats','least_assigned_leads','weighted','specific_agent','manual']);
function fail(message, status = 422) { throw Object.assign(new Error(message), { status }); }
function cleanRule(payload, current = {}) {
  const result = {};
  const fields = ['name','isEnabled','priority','assignmentStrategy','departmentId','fallbackDepartmentId','fallbackAgentId','managerUserId','respectWorkingHours','stickyAssignment','reassignIfUnavailable','reassignAfterMinutes','maxOpenChatsPerAgent','allowGlobalFallback','notifyManagerWhenUnassigned'];
  fields.forEach((key) => { if (payload[key] !== undefined) result[key] = payload[key] === '' ? null : payload[key]; });
  if (result.assignmentStrategy && !STRATEGIES.has(result.assignmentStrategy)) fail('Unsupported assignment strategy.');
  ['priority','reassignAfterMinutes','maxOpenChatsPerAgent'].forEach((key) => { if (result[key] != null && (!Number.isInteger(Number(result[key])) || Number(result[key]) < 0)) fail(`${key} must be a non-negative integer.`); });
  if (!String(result.name ?? current.name ?? '').trim()) fail('Rule name is required.');
  return result;
}
class WhatsAppRoutingAdminService {
  async access(accountId, userId) { return accountAccess.assertAccess(accountId, userId); }
  include() { return [{ model: models.WhatsAppRoutingRuleAgent, as: 'agents', include: [{ model: models.User, as: 'agent', attributes: ['id','firstName','lastName','email','status','isAvailable','leaveUntil'] }] }, { model: models.Role, as: 'department', attributes: ['id','name'] }, { model: models.Role, as: 'fallbackDepartment', attributes: ['id','name'] }, { model: models.User, as: 'fallbackAgent', attributes: ['id','firstName','lastName','email'] }]; }
  async list(accountId, userId) { await this.access(accountId, userId); return models.WhatsAppRoutingRule.findAll({ where: { whatsappAccountId: accountId }, include: this.include(), order: [['isEnabled','DESC'],['priority','DESC'],['id','ASC']] }); }
  async getRule(accountId, ruleId, transaction = null) { const row = await models.WhatsAppRoutingRule.findOne({ where: { id: ruleId, whatsappAccountId: accountId }, transaction }); if (!row) fail('Routing rule not found.', 404); return row; }
  async create(accountId, payload, userId) {
    await this.access(accountId, userId); const values = cleanRule(payload);
    return models.sequelize.transaction(async (transaction) => {
      if (values.isEnabled !== false && await models.WhatsAppRoutingRule.count({ where: { whatsappAccountId: accountId, isEnabled: true }, transaction })) fail('This WhatsApp account already has an active routing rule.', 409);
      const row = await models.WhatsAppRoutingRule.create({ ...values, whatsappAccountId: accountId, createdBy: userId }, { transaction });
      if (Array.isArray(payload.agents)) for (const member of payload.agents) await this.upsertAgent(accountId, row.id, member.agentId, member, userId, transaction);
      return row;
    });
  }
  async update(accountId, ruleId, payload, userId) {
    await this.access(accountId, userId); return models.sequelize.transaction(async (transaction) => {
      const row = await this.getRule(accountId, ruleId, transaction); const values = cleanRule(payload, row);
      if (values.isEnabled === true && !row.isEnabled && await models.WhatsAppRoutingRule.count({ where: { whatsappAccountId: accountId, isEnabled: true, id: { [Op.ne]: row.id } }, transaction })) fail('Disable the current active rule first.', 409);
      await row.update(values, { transaction }); return row;
    });
  }
  async remove(accountId, ruleId, userId) { await this.access(accountId, userId); const row = await this.getRule(accountId, ruleId); await row.destroy(); return { id: row.id, deleted: true }; }
  async eligibleAgents(accountId, userId, { search = '', page = 1, limit = 50 } = {}) {
    await this.access(accountId, userId); const offset = (Math.max(Number(page), 1) - 1) * Math.min(Number(limit) || 50, 100);
    const where = { status: 'active', ...(search ? { [Op.or]: [{ firstName: { [Op.iLike]: `%${search}%` } }, { lastName: { [Op.iLike]: `%${search}%` } }, { email: { [Op.iLike]: `%${search}%` } }] } : {}) };
    const result = await models.User.findAndCountAll({ where, attributes: ['id','firstName','lastName','email','status','isAvailable','leaveUntil','isSystemAdmin'], include: [{ model: models.Role, as: 'roles', attributes: ['id','name'], through: { attributes: [] }, include: [{ model: models.Permission, as: 'permissions', attributes: ['code'], through: { attributes: [] }, required: false }, { model: models.WhatsAppAccount, as: 'whatsappAccounts', attributes: ['id'], through: { attributes: [] }, required: false }] }], limit: Math.min(Number(limit) || 50, 100), offset, distinct: true, order: [['firstName','ASC'],['id','ASC']] });
    const rows = result.rows.filter((agent) => {
      const validRole = agent.isSystemAdmin || (agent.roles || []).some((role) => String(role.name).toLowerCase() === 'agent' || (role.permissions || []).some((permission) => ['lead.assign','lead.reassign','conversation.claim_unassigned','conversation.reassign'].includes(permission.code)));
      const mapped = (agent.roles || []).flatMap((role) => role.whatsappAccounts || []); return validRole && (!mapped.length || mapped.some((account) => String(account.id) === String(accountId)));
    });
    const ids = rows.map((row) => row.id); const loads = ids.length ? await Promise.all([models.Conversation.findAll({ attributes: ['assignedUserId',[fn('count',col('id')),'count']], where: { assignedUserId: { [Op.in]: ids }, status: { [Op.in]: ['open','pending'] } }, group: ['assignedUserId'], raw: true }), models.Lead.findAll({ attributes: ['ownerId',[fn('count',col('id')),'count']], where: { ownerId: { [Op.in]: ids } }, group: ['ownerId'], raw: true })]) : [[],[]];
    const chatMap = new Map(loads[0].map((r) => [String(r.assignedUserId), Number(r.count)])); const leadMap = new Map(loads[1].map((r) => [String(r.ownerId), Number(r.count)]));
    return { rows: rows.map((row) => { const data = row.toJSON(); delete data.isSystemAdmin; return { ...data, name: [row.firstName,row.lastName].filter(Boolean).join(' ') || row.email, department: row.roles?.[0]?.name || null, openChats: chatMap.get(String(row.id)) || 0, assignedLeads: leadMap.get(String(row.id)) || 0 }; }), count: rows.length, page: Math.max(Number(page),1), scannedCount: result.count };
  }
  async upsertAgent(accountId, ruleId, agentId, payload, userId, transaction = null) {
    await this.access(accountId, userId); await this.getRule(accountId, ruleId, transaction); const agent = await models.User.findByPk(agentId, { transaction }); if (!agent) fail('Agent not found.', 404);
    const values = { weight: Math.max(1, Number(payload.weight) || 1), priority: Math.max(0, Number(payload.priority) || 0), maxOpenChats: payload.maxOpenChats === '' || payload.maxOpenChats == null ? null : Math.max(0, Number(payload.maxOpenChats)), isEnabled: payload.isEnabled !== false };
    const [row] = await models.WhatsAppRoutingRuleAgent.upsert({ routingRuleId: ruleId, agentId, ...values }, { transaction, returning: true }); return row;
  }
  async removeAgent(accountId, ruleId, agentId, userId) { await this.access(accountId, userId); await this.getRule(accountId, ruleId); const count = await models.WhatsAppRoutingRuleAgent.destroy({ where: { routingRuleId: ruleId, agentId } }); if (!count) fail('Agent membership not found.', 404); return { deleted: true }; }
  async test(accountId, payload, userId) {
    await this.access(accountId, userId); if (payload.simulate === false) return routingService.routeInboundLead({ ...payload, whatsappAccountId: accountId });
    const rule = await models.WhatsAppRoutingRule.findOne({ where: { whatsappAccountId: accountId, isEnabled: true }, order: [['priority','DESC'],['id','ASC']] });
    if (!rule) return { matchedRule: null, eligibleAgents: [], excludedAgents: [], selectedAgent: null, strategy: null, fallbackUsed: false };
    let evaluation = await routingService.evaluate(rule); let selectedAgent = routingService.select(rule, evaluation.eligible); let fallbackUsed = false;
    if (rule.assignmentStrategy !== 'manual' && !selectedAgent && rule.fallbackAgentId) { const fallback = await routingService.evaluate(rule, { fallbackAgentOnly: true }); selectedAgent = fallback.eligible[0] || null; evaluation = { eligible: evaluation.eligible, excluded: [...evaluation.excluded, ...fallback.excluded] }; fallbackUsed = Boolean(selectedAgent); }
    if (rule.assignmentStrategy !== 'manual' && !selectedAgent && rule.fallbackDepartmentId) { const fallback = await routingService.evaluate(rule, { includeFallbackDepartment: true }); selectedAgent = routingService.select({ ...rule.toJSON(), assignmentStrategy: 'least_open_chats', departmentId: null }, fallback.eligible); evaluation = { eligible: [...evaluation.eligible, ...fallback.eligible], excluded: [...evaluation.excluded, ...fallback.excluded] }; fallbackUsed = Boolean(selectedAgent); }
    if (rule.assignmentStrategy !== 'manual' && !selectedAgent && rule.allowGlobalFallback) { const agent = await require('./assignment.service').chooseNextAgent().catch(() => null); selectedAgent = agent ? { agentId: agent.id, name: [agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.email } : null; fallbackUsed = Boolean(selectedAgent); }
    return { matchedRule: { id: rule.id, name: rule.name }, eligibleAgents: evaluation.eligible, excludedAgents: evaluation.excluded, selectedAgent, strategy: rule.assignmentStrategy, fallbackUsed };
  }
  async analytics(accountId, userId) {
    await this.access(accountId, userId); const leads = await models.Lead.findAll({ where: { whatsappAccountId: accountId }, attributes: ['id','ownerId','convertedAt','createdAt'] });
    const conversations = await models.Conversation.findAll({ where: { whatsappAccountId: accountId }, attributes: ['id','assignedUserId','status'] }); const assigned = leads.filter((lead) => lead.ownerId).length; const converted = leads.filter((lead) => lead.convertedAt).length;
    const messages = await models.Message.findAll({ where: { whatsappAccountId: accountId, direction: { [Op.in]: ['inbound','outbound'] } }, attributes: ['conversationId','direction','createdAt','isInternalNotification'], order: [['conversationId','ASC'],['createdAt','ASC']] });
    const responseTimes = []; const firstInbound = new Map();
    for (const message of messages) { const key = String(message.conversationId); if (message.direction === 'inbound' && !firstInbound.has(key)) firstInbound.set(key, new Date(message.createdAt)); else if (message.direction === 'outbound' && !message.isInternalNotification && firstInbound.has(key)) { responseTimes.push(new Date(message.createdAt) - firstInbound.get(key)); firstInbound.delete(key); } }
    const distribution = new Map(); leads.forEach((lead) => { if (lead.ownerId) distribution.set(String(lead.ownerId), (distribution.get(String(lead.ownerId)) || 0) + 1); });
    const rule = await models.WhatsAppRoutingRule.findOne({ where: { whatsappAccountId: accountId, isEnabled: true } }); const evaluation = rule ? await routingService.evaluate(rule) : { eligible: [], excluded: [] };
    return { whatsappAccountId: accountId, leadsReceived: leads.length, assignedLeads: assigned, unassignedLeads: leads.length - assigned, convertedLeads: converted, conversionRate: leads.length ? Number(((converted / leads.length) * 100).toFixed(2)) : 0, averageFirstResponseSeconds: responseTimes.length ? Math.round(responseTimes.reduce((sum, value) => sum + value, 0) / responseTimes.length / 1000) : null, agentAssignmentDistribution: [...distribution].map(([agentId, count]) => ({ agentId, count })), openChats: conversations.filter((row) => ['open','pending'].includes(row.status)).length, poolWorkload: [...evaluation.eligible, ...evaluation.excluded].map(({ agentId, name, openChats, assignedLeads, capacity }) => ({ agentId, name, openChats, assignedLeads, capacity })) };
  }
}
module.exports = new WhatsAppRoutingAdminService();
