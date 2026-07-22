const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const routing = require('../src/services/whatsappLeadRouting.service');

const eligible = [
  { agentId: 1, priority: 0, weight: 1, openChats: 3, assignedLeads: 1, assignmentCount: 2 },
  { agentId: 2, priority: 0, weight: 3, openChats: 1, assignedLeads: 4, assignmentCount: 3 },
  { agentId: 3, priority: 0, weight: 1, openChats: 1, assignedLeads: 1, assignmentCount: 4 }
];
function rule(assignmentStrategy, values = {}) { return { assignmentStrategy, lastAssignedAgentId: null, fallbackAgentId: null, ...values }; }

test('least-open-chats is deterministic', () => assert.equal(routing.select(rule('least_open_chats'), eligible).agentId, 2));
test('least-assigned-leads is deterministic', () => assert.equal(routing.select(rule('least_assigned_leads'), eligible).agentId, 1));
test('weighted strategy compares assignment-to-weight ratios', () => assert.equal(routing.select(rule('weighted'), eligible).agentId, 2));
test('round robin advances after the rule-local cursor', () => assert.equal(routing.select(rule('round_robin', { lastAssignedAgentId: 2 }), eligible).agentId, 3));
test('specific-agent never substitutes another pool member', () => { assert.equal(routing.select(rule('specific_agent', { fallbackAgentId: 3 }), eligible).agentId, 3); assert.equal(routing.select(rule('specific_agent', { fallbackAgentId: 99 }), eligible), null); });
test('manual strategy leaves the lead unassigned', () => assert.equal(routing.select(rule('manual'), eligible), null));

test('working-hours evaluation uses the configured timezone and schedule', () => {
  const user = { workingHours: { timezone: 'UTC', days: { wed: [{ start: '08:00', end: '17:00' }] } } };
  assert.equal(routing.inWorkingHours(user, new Date('2026-07-22T09:00:00Z')), true);
  assert.equal(routing.inWorkingHours(user, new Date('2026-07-22T18:00:00Z')), false);
  assert.equal(routing.inWorkingHours({}, new Date()), false);
});

test('migration is additive, idempotent and does not assume role_permission timestamps', () => {
  const source = fs.readFileSync(path.join(__dirname, '../migrations/043_whatsapp_number_routing.js'), 'utf8');
  assert.match(source, /tableExists/); assert.match(source, /CREATE UNIQUE INDEX IF NOT EXISTS wa_routing_one_active_rule_idx/);
  assert.match(source, /granted_at/); assert.doesNotMatch(source, /role_permissions[^\n]+updated_at/);
});

test('inbound integration passes exact canonical account identity and source message', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/leadManagement.service.js'), 'utf8');
  assert.match(source, /routeInboundLead\(\{/); assert.match(source, /whatsappAccountId, conversationId: conversation\.id, contactId: contact\.id/); assert.match(source, /sourceMessageId/);
  const webhook = fs.readFileSync(path.join(__dirname, '../src/services/whatsapp.service.js'), 'utf8');
  assert.match(webhook, /value\.metadata\?\.phone_number_id/); assert.match(webhook, /sourceMessageId: message\.id/);
});
