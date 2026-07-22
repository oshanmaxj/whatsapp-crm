const { Op, fn, col, where } = require('sequelize');
const models = require('../models');
const leadAssignmentService = require('./leadAssignment.service');
const globalAssignmentService = require('./assignment.service');

const ACTIVE_CONVERSATIONS = ['open', 'pending'];
const ACTIVE_LEAD_STAGES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation'];

function id(value) { return value == null ? null : String(value); }
function userName(user) { return [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || null; }
function compareAgentId(a, b) { try { return BigInt(a.agentId) < BigInt(b.agentId) ? -1 : BigInt(a.agentId) > BigInt(b.agentId) ? 1 : 0; } catch { return String(a.agentId).localeCompare(String(b.agentId)); } }
function inWorkingHours(user, now = new Date()) {
  const schedule = user.workingHours;
  if (!schedule || typeof schedule !== 'object') return false;
  const timezone = schedule.timezone || 'UTC';
  let parts;
  try { parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value])); } catch { return false; }
  const slots = schedule.days?.[String(parts.weekday || '').slice(0, 3).toLowerCase()] || schedule[String(parts.weekday || '').slice(0, 3).toLowerCase()] || [];
  const current = `${parts.hour}:${parts.minute}`;
  return slots.some((slot) => current >= slot.start && current < slot.end);
}

function createService(dependencies = {}) {
  const db = dependencies.models || models;
  const assignment = dependencies.leadAssignmentService || leadAssignmentService;
  const globalAssignment = dependencies.globalAssignmentService || globalAssignmentService;

  async function workload(agentIds, transaction) {
    if (!agentIds.length) return new Map();
    const [chats, leads, assignments] = await Promise.all([
      db.Conversation.findAll({ attributes: ['assignedUserId', [fn('count', col('id')), 'count']], where: { assignedUserId: { [Op.in]: agentIds }, status: { [Op.in]: ACTIVE_CONVERSATIONS } }, group: ['assignedUserId'], raw: true, transaction }),
      db.Lead.findAll({ attributes: ['ownerId', [fn('count', col('id')), 'count']], where: { ownerId: { [Op.in]: agentIds }, stage: { [Op.in]: ACTIVE_LEAD_STAGES } }, group: ['ownerId'], raw: true, transaction }),
      db.LeadAssignment.findAll({ attributes: ['assignedTo', [fn('count', col('id')), 'count']], where: { assignedTo: { [Op.in]: agentIds } }, group: ['assignedTo'], raw: true, transaction })
    ]);
    const map = new Map(agentIds.map((agentId) => [id(agentId), { openChats: 0, assignedLeads: 0, assignmentCount: 0 }]));
    chats.forEach((row) => { map.get(id(row.assignedUserId)).openChats = Number(row.count); });
    leads.forEach((row) => { map.get(id(row.ownerId)).assignedLeads = Number(row.count); });
    assignments.forEach((row) => { map.get(id(row.assignedTo)).assignmentCount = Number(row.count); });
    return map;
  }

  const roleInclude = () => ({ model: db.Role, as: 'roles', through: { attributes: [] }, include: [{ model: db.WhatsAppAccount, as: 'whatsappAccounts', through: { attributes: [] }, required: false }, { model: db.Permission, as: 'permissions', through: { attributes: [] }, required: false }] });
  async function evaluate(rule, { transaction, now = new Date(), includeFallbackDepartment = false, fallbackAgentOnly = false } = {}) {
    let memberships = fallbackAgentOnly ? [] : await db.WhatsAppRoutingRuleAgent.findAll({ where: { routingRuleId: rule.id }, include: [{ model: db.User, as: 'agent', include: [roleInclude()] }], order: [['priority', 'DESC'], ['agentId', 'ASC']], transaction });
    if (fallbackAgentOnly && rule.fallbackAgentId) {
      const agent = await db.User.findByPk(rule.fallbackAgentId, { include: [roleInclude()], transaction });
      if (agent) memberships = [{ agentId: agent.id, agent, isEnabled: true, weight: 1, priority: 0, maxOpenChats: null }];
    }
    if (includeFallbackDepartment && rule.fallbackDepartmentId) {
      const departmentUsers = await db.User.findAll({ attributes: ['id'], include: [{ model: db.Role, as: 'roles', where: { id: rule.fallbackDepartmentId }, through: { attributes: [] }, attributes: [] }], transaction });
      const users = departmentUsers.length ? await db.User.findAll({ where: { id: { [Op.in]: departmentUsers.map((user) => user.id) } }, include: [roleInclude()], transaction }) : [];
      memberships = users.map((agent) => ({ agentId: agent.id, agent, isEnabled: true, weight: 1, priority: 0, maxOpenChats: null }));
    }
    const loads = await workload(memberships.map((item) => item.agentId), transaction);
    const eligible = []; const excluded = [];
    for (const membership of memberships) {
      const agent = membership.agent; const reasons = []; const load = loads.get(id(membership.agentId)) || { openChats: 0, assignedLeads: 0, assignmentCount: 0 };
      if (!membership.isEnabled) reasons.push('pool_membership_disabled');
      if (!agent || agent.deletedAt || agent.status !== 'active') reasons.push('agent_inactive');
      const assignmentRole = agent?.isSystemAdmin || (agent?.roles || []).some((role) => String(role.name || '').toLowerCase() === 'agent' || (role.permissions || []).some((permission) => ['lead.assign','lead.reassign','conversation.claim_unassigned','conversation.reassign'].includes(permission.code)));
      if (agent && !assignmentRole) reasons.push('assignment_permission_missing');
      if (agent && agent.isAvailable === false) reasons.push('agent_unavailable');
      if (agent?.leaveUntil && new Date(agent.leaveUntil) > now) reasons.push('agent_on_leave');
      if (rule.respectWorkingHours && !inWorkingHours(agent, now)) reasons.push('outside_working_hours');
      const capacity = membership.maxOpenChats ?? rule.maxOpenChatsPerAgent;
      if (capacity != null && load.openChats >= Number(capacity)) reasons.push('capacity_reached');
      if (rule.departmentId && !(agent?.roles || []).some((role) => id(role.id) === id(rule.departmentId))) reasons.push('department_mismatch');
      const mappedAccounts = (agent?.roles || []).flatMap((role) => role.whatsappAccounts || []);
      if (mappedAccounts.length && !mappedAccounts.some((account) => id(account.id) === id(rule.whatsappAccountId))) reasons.push('account_access_denied');
      const result = { agentId: membership.agentId, name: userName(agent), department: agent?.roles?.[0]?.name || null, availability: agent?.isAvailable !== false, capacity: capacity ?? null, weight: Number(membership.weight || 1), priority: Number(membership.priority || 0), ...load };
      if (reasons.length) excluded.push({ ...result, reasons }); else eligible.push(result);
    }
    return { eligible, excluded };
  }

  function select(rule, eligible) {
    if (!eligible.length || rule.assignmentStrategy === 'manual') return null;
    const ordered = [...eligible].sort((a, b) => b.priority - a.priority || compareAgentId(a, b));
    if (rule.assignmentStrategy === 'specific_agent') return ordered.find((item) => id(item.agentId) === id(rule.fallbackAgentId)) || null;
    if (rule.assignmentStrategy === 'round_robin') {
      const previous = ordered.findIndex((item) => id(item.agentId) === id(rule.lastAssignedAgentId));
      return ordered[(previous + 1) % ordered.length];
    }
    if (rule.assignmentStrategy === 'least_assigned_leads') return ordered.sort((a, b) => a.assignedLeads - b.assignedLeads || b.priority - a.priority || compareAgentId(a, b))[0];
    if (rule.assignmentStrategy === 'weighted') return ordered.sort((a, b) => (a.assignmentCount / Math.max(a.weight, 1)) - (b.assignmentCount / Math.max(b.weight, 1)) || b.priority - a.priority || compareAgentId(a, b))[0];
    return ordered.sort((a, b) => a.openChats - b.openChats || b.priority - a.priority || compareAgentId(a, b))[0];
  }

  async function notifyUnassigned({ rule, whatsappAccountId, conversationId, contactId, leadId, sourceMessageId, excluded, transaction }) {
    const reasons = excluded.map((item) => ({ agentId: item.agentId, reasons: item.reasons }));
    await db.WhatsAppRoutingUnassigned.findOrCreate({ where: { conversationId, status: 'open' }, defaults: { whatsappAccountId, routingRuleId: rule?.id || null, conversationId, contactId, leadId, sourceMessageId, exclusionReasons: reasons }, transaction });
    if (rule?.notifyManagerWhenUnassigned !== false) {
      let recipientIds = rule?.managerUserId ? [rule.managerUserId] : (await db.User.findAll({ where: { isSystemAdmin: true, status: 'active' }, attributes: ['id'], transaction })).map((user) => user.id);
      if (!recipientIds.length) {
        const adminRole = await db.Role.findOne({ where: where(fn('lower', col('name')), 'admin'), transaction });
        if (adminRole) recipientIds = (await adminRole.getUsers({ where: { status: 'active' }, attributes: ['id'], transaction })).map((user) => user.id);
      }
      if (!recipientIds.length) recipientIds = [null];
      for (const userId of [...new Set(recipientIds.map((value) => value == null ? null : String(value)))]) await db.Notification.create({ userId, type: 'whatsapp_routing_unassigned', title: 'WhatsApp lead requires assignment', message: 'No eligible agent was available for an inbound WhatsApp lead.', data: { whatsappAccountId, conversationId, contactId, leadId, exclusionReasons: reasons } }, { transaction });
    }
  }

  async function routeInboundLead(input) {
    const execute = async (transaction) => {
      const { whatsappAccountId, conversationId, contactId, leadId, sourceMessageId } = input;
      if (!whatsappAccountId || !conversationId || !contactId || !leadId) throw Object.assign(new Error('Complete inbound routing identity is required.'), { code: 'ROUTING_IDENTITY_REQUIRED', status: 422 });
      if (db.sequelize.getDialect() === 'postgres') await db.sequelize.query('SELECT pg_advisory_xact_lock(:key)', { replacements: { key: Number(whatsappAccountId) }, transaction });
      const conversation = await db.Conversation.findByPk(conversationId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!conversation || id(conversation.whatsappAccountId) !== id(whatsappAccountId) || id(conversation.contactId) !== id(contactId)) throw Object.assign(new Error('Inbound conversation identity does not match the WhatsApp account and contact.'), { code: 'ROUTING_IDENTITY_MISMATCH', status: 409 });
      if (conversation.assignedUserId) return { selectedAgent: { agentId: conversation.assignedUserId }, source: 'existing_conversation', fallbackUsed: false };
      const rule = await db.WhatsAppRoutingRule.findOne({ where: { whatsappAccountId, isEnabled: true }, order: [['priority', 'DESC'], ['id', 'ASC']], transaction, lock: transaction.LOCK.UPDATE });
      if (!rule) {
        await notifyUnassigned({ rule: null, whatsappAccountId, conversationId, contactId, leadId, sourceMessageId, excluded: [], transaction });
        return { matchedRule: null, eligibleAgents: [], excludedAgents: [], selectedAgent: null, strategy: null, fallbackUsed: false, source: 'unassigned' };
      }
      let evaluation = await evaluate(rule, { transaction });
      if (rule.assignmentStrategy === 'manual') {
        await notifyUnassigned({ rule, whatsappAccountId, conversationId, contactId, leadId, sourceMessageId, excluded: evaluation.excluded, transaction });
        return { matchedRule: rule, eligibleAgents: evaluation.eligible, excludedAgents: evaluation.excluded, selectedAgent: null, strategy: 'manual', fallbackUsed: false, source: 'unassigned' };
      }
      if (rule.stickyAssignment) {
        const sticky = await db.Conversation.findOne({ where: { whatsappAccountId, contactId, assignedUserId: { [Op.ne]: null }, id: { [Op.ne]: conversationId } }, order: [['lastMessageAt', 'DESC'], ['id', 'DESC']], transaction });
        if (sticky) {
          const membership = await db.WhatsAppRoutingRuleAgent.findOne({ where: { routingRuleId: rule.id, agentId: sticky.assignedUserId, isEnabled: true }, transaction });
          const agent = membership ? await db.User.findOne({ where: { id: sticky.assignedUserId, status: 'active' }, transaction }) : null;
          const fullyEligible = evaluation.eligible.some((item) => id(item.agentId) === id(agent?.id));
          const unavailableForMinutes = sticky.lastMessageAt ? (Date.now() - new Date(sticky.lastMessageAt).getTime()) / 60000 : Number.POSITIVE_INFINITY;
          const timeoutPending = rule.reassignIfUnavailable && rule.reassignAfterMinutes != null && unavailableForMinutes < Number(rule.reassignAfterMinutes);
          if (agent && (!rule.reassignIfUnavailable || fullyEligible || timeoutPending)) {
            await assignment.assignAgent({ leadId, conversationId, ownerId: agent.id, source: 'incoming_whatsapp', reason: 'Sticky WhatsApp ownership', transaction });
            return { matchedRule: rule, selectedAgent: { agentId: agent.id, name: userName(agent) }, eligibleAgents: [], excludedAgents: [], strategy: rule.assignmentStrategy, fallbackUsed: false, source: 'sticky' };
          }
        }
      }
      let selected = select(rule, evaluation.eligible); let fallbackUsed = false;
      if (!selected && rule.fallbackAgentId) {
        const fallback = await evaluate(rule, { transaction, fallbackAgentOnly: true });
        if (fallback.eligible[0]) { selected = fallback.eligible[0]; fallbackUsed = true; }
        evaluation = { eligible: evaluation.eligible, excluded: [...evaluation.excluded, ...fallback.excluded] };
      }
      if (!selected && rule.fallbackDepartmentId) {
        const fallback = await evaluate(rule, { transaction, includeFallbackDepartment: true });
        selected = select({ ...rule.toJSON(), assignmentStrategy: 'least_open_chats', departmentId: null }, fallback.eligible); fallbackUsed = Boolean(selected);
        evaluation = { eligible: [...evaluation.eligible, ...fallback.eligible], excluded: [...evaluation.excluded, ...fallback.excluded] };
      }
      if (!selected && rule.allowGlobalFallback) {
        const result = await globalAssignment.assignLead(leadId, null, { source: 'incoming_whatsapp', note: 'Explicit global WhatsApp routing fallback', transaction });
        selected = result.assignee ? { agentId: result.assignee.id, name: userName(result.assignee) } : null; fallbackUsed = Boolean(selected);
      } else if (selected) {
        await assignment.assignAgent({ leadId, conversationId, ownerId: selected.agentId, source: 'incoming_whatsapp', reason: `WhatsApp routing: ${rule.name}`, transaction });
      }
      if (selected) await rule.update({ lastAssignedAgentId: selected.agentId }, { transaction });
      else await notifyUnassigned({ rule, whatsappAccountId, conversationId, contactId, leadId, sourceMessageId, excluded: evaluation.excluded, transaction });
      return { matchedRule: rule, eligibleAgents: evaluation.eligible, excludedAgents: evaluation.excluded, selectedAgent: selected, strategy: rule.assignmentStrategy, fallbackUsed, source: selected ? 'routing_rule' : 'unassigned' };
    };
    return input.transaction ? execute(input.transaction) : db.sequelize.transaction(execute);
  }

  return { routeInboundLead, evaluate, select, inWorkingHours };
}

module.exports = createService();
module.exports.createWhatsappLeadRoutingService = createService;
module.exports.inWorkingHours = inWorkingHours;
