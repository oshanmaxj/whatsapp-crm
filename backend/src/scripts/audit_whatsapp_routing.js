require('dotenv').config();
const { Op } = require('sequelize');
const { sequelize, WhatsAppAccount, WhatsAppRoutingRule, WhatsAppRoutingRuleAgent, WhatsAppRoutingUnassigned, User, Role, Lead, Conversation } = require('../models');

async function run() {
  const apply = process.argv.includes('--apply');
  await sequelize.authenticate();
  const accounts = await WhatsAppAccount.findAll({ where: { status: 'active' }, attributes: ['id','name'] });
  const rules = await WhatsAppRoutingRule.findAll({ paranoid: false, include: [{ model: WhatsAppRoutingRuleAgent, as: 'agents', include: [{ model: User, as: 'agent', paranoid: false }] }] });
  const activeRules = rules.filter((rule) => rule.isEnabled && !rule.deletedAt);
  const accountRuleCounts = new Map(); activeRules.forEach((rule) => accountRuleCounts.set(String(rule.whatsappAccountId), (accountRuleCounts.get(String(rule.whatsappAccountId)) || 0) + 1));
  const report = {
    accountsWithoutRule: accounts.filter((account) => !accountRuleCounts.has(String(account.id))).map((account) => ({ id: account.id, name: account.name })),
    rulesWithoutAgents: activeRules.filter((rule) => !rule.agents?.some((member) => member.isEnabled)).map((rule) => ({ id: rule.id, name: rule.name, whatsappAccountId: rule.whatsappAccountId })),
    disabledOrDeletedAgentsInPools: rules.flatMap((rule) => (rule.agents || []).filter((member) => !member.agent || member.agent.deletedAt || member.agent.status !== 'active').map((member) => ({ ruleId: rule.id, agentId: member.agentId, status: member.agent?.status || 'deleted' }))),
    duplicateActiveRules: [...accountRuleCounts].filter(([, count]) => count > 1).map(([whatsappAccountId, count]) => ({ whatsappAccountId, count })),
    invalidDepartmentLinks: [], agentsOverCapacity: [], unassignedRecentLeadsByAccount: []
  };
  const roleIds = new Set((await Role.findAll({ paranoid: false, attributes: ['id'] })).map((role) => String(role.id)));
  report.invalidDepartmentLinks = rules.filter((rule) => (rule.departmentId && !roleIds.has(String(rule.departmentId))) || (rule.fallbackDepartmentId && !roleIds.has(String(rule.fallbackDepartmentId)))).map((rule) => ({ ruleId: rule.id, departmentId: rule.departmentId, fallbackDepartmentId: rule.fallbackDepartmentId }));
  for (const rule of activeRules) for (const member of rule.agents || []) { const capacity = member.maxOpenChats ?? rule.maxOpenChatsPerAgent; if (capacity == null) continue; const openChats = await Conversation.count({ where: { assignedUserId: member.agentId, status: { [Op.in]: ['open','pending'] } } }); if (openChats > Number(capacity)) report.agentsOverCapacity.push({ ruleId: rule.id, agentId: member.agentId, openChats, capacity: Number(capacity) }); }
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); const unassigned = await Lead.findAll({ attributes: ['whatsappAccountId', [sequelize.fn('count', sequelize.col('id')), 'count']], where: { ownerId: null, createdAt: { [Op.gte]: since } }, group: ['whatsappAccountId'], raw: true }); report.unassignedRecentLeadsByAccount = unassigned.map((row) => ({ whatsappAccountId: row.whatsappAccountId, count: Number(row.count) }));
  let repairsApplied = 0;
  if (apply) repairsApplied = await sequelize.transaction(async (transaction) => {
    const [, metadata] = await sequelize.query("UPDATE whatsapp_routing_unassigned_queue q SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP FROM leads l WHERE q.lead_id = l.id AND q.status = 'open' AND l.owner_id IS NOT NULL", { transaction });
    return Number(metadata?.rowCount ?? metadata ?? 0);
  });
  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), mode: apply ? 'safe-apply' : 'report-only', repairsApplied, report }, null, 2));
  await sequelize.close();
}
run().catch((error) => { console.error(`WhatsApp routing audit failed: ${error.message}`); process.exitCode = 1; });
