const test = require('node:test');
const assert = require('node:assert/strict');
const { createLeadAssignmentService } = require('../src/services/leadAssignment.service');

function environment() {
  const writes = { leadAssignments: [], activities: [], histories: [], messages: [], audits: [] };
  const events = [];
  const lead = {
    id: 55, ownerId: 10, statusId: 2, stage: 'contacted', updatedAt: '2026-07-16T00:00:00.000Z',
    async update(values) { Object.assign(this, values); }
  };
  const conversations = [101, 102].map((id) => ({
    id, leadId: 55, contactId: 80 + id, whatsappAccountId: 4, assignedUserId: 10,
    async update(values) { Object.assign(this, values); }
  }));
  const users = [10, 20, 99].map((id) => ({ id, status: 'active', firstName: `User${id}`, async reload() {} }));
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const service = createLeadAssignmentService({
    sequelize: { async transaction(callback) { return callback(transaction); } },
    Lead: { async findByPk() { return lead; } },
    Conversation: {
      async findByPk(id) { return conversations.find((row) => String(row.id) === String(id)) || null; },
      async findAll() { return conversations; }
    },
    User: {
      async findOne({ where }) { return users.find((user) => String(user.id) === String(where.id) && user.status === where.status) || null; },
      async findAll({ where }) { return users.filter((user) => where.id.includes(user.id)); }
    },
    LeadAssignment: { async create(values) { writes.leadAssignments.push(values); } },
    LeadActivity: { async create(values) { writes.activities.push(values); } },
    ConversationAssignmentHistory: { async create(values) { writes.histories.push(values); } },
    Message: { async create(values) { writes.messages.push(values); } },
    auditService: { async record(values) { writes.audits.push(values); } },
    socketService: { emit(name, payload) { events.push({ name, payload }); } }
  });
  return { service, lead, conversations, writes, events };
}

const leadActor = { id: 99, permissions: ['lead.reassign'] };
const chatActor = { id: 99, permissions: ['conversation.reassign'] };

for (const [source, target, actor] of [
  ['Leads page', { leadId: 55, source: 'leads_page' }, leadActor],
  ['Chat workspace', { conversationId: 101, source: 'chat_workspace' }, chatActor]
]) {
  test(`${source} assignment synchronizes lead and every conversation`, async () => {
    const env = environment();
    const result = await env.service.assignAgent({ ...target, ownerId: 20, actor, reason: 'Handoff' });
    assert.equal(env.lead.ownerId, 20);
    assert.ok(env.conversations.every((row) => row.assignedUserId === 20));
    assert.equal(env.writes.leadAssignments.length, 1);
    assert.equal(env.writes.histories.length, 2);
    assert.equal(env.writes.messages.length, 2);
    assert.equal(env.writes.activities[0].activityType, 'LEAD_REASSIGNED');
    assert.equal(env.writes.audits.length, 1);
    assert.equal(env.writes.audits[0].required, true);
    assert.equal(result.ownerId, 20);
    assert.deepEqual(env.events.map((event) => event.name), ['lead.updated', 'lead.agent.changed']);
  });
}

test('repeating the same assignment creates no duplicate records or events', async () => {
  const env = environment();
  await env.service.assignAgent({ leadId: 55, ownerId: 10, actor: leadActor, source: 'leads_page' });
  assert.deepEqual(env.writes, { leadAssignments: [], activities: [], histories: [], messages: [], audits: [] });
  assert.equal(env.events.length, 0);
});

test('automated WhatsApp assignment records an explicit webhook actor without a fake user', async () => {
  const env = environment();
  await env.service.assignAgent({ leadId: 55, ownerId: 20, source: 'incoming_whatsapp', reason: 'Routing rule' });
  assert.equal(env.writes.histories.length, 2);
  assert.ok(env.writes.histories.every((row) => row.changedByUserId === null));
  assert.ok(env.writes.histories.every((row) => row.actorType === 'webhook'));
  assert.ok(env.writes.histories.every((row) => row.source === 'incoming_whatsapp'));
});

test('a human assignment without an authenticated actor fails before any transaction writes', async () => {
  const env = environment();
  await assert.rejects(
    env.service.assignAgent({ leadId: 55, ownerId: 20, source: 'leads_page' }),
    (error) => error.code === 'ASSIGNMENT_ACTOR_REQUIRED'
  );
  assert.deepEqual(env.writes, { leadAssignments: [], activities: [], histories: [], messages: [], audits: [] });
});

test('assignment history uses the authenticated Users-table ID', async () => {
  const env = environment();
  await env.service.assignAgent({ leadId: 55, ownerId: 20, actor: leadActor, source: 'leads_page' });
  assert.ok(env.writes.histories.every((row) => row.changedByUserId === leadActor.id));
  assert.ok(env.writes.histories.every((row) => row.actorType === 'user'));
});
