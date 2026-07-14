const test = require('node:test');
const assert = require('node:assert/strict');
const { createLeadStatusService } = require('../src/services/leadStatus.service');
const leadService = require('../src/services/lead.service');
const leadController = require('../src/controllers/lead.controller');

const definitions = [
  ['new', 'New'], ['contacted', 'Contacted'], ['interested', 'Interested'],
  ['ignore', 'Ignore'], ['agreed', 'Agreed'], ['registered', 'Registered'], ['lost', 'Lost']
];

function environment({ current = 'new', ownerId = 10, missingLead = false, activityError = null, auditError = null } = {}) {
  const statuses = definitions.map(([code, name], index) => ({
    id: index + 1, code, name, active: true,
    toJSON() { return { id: this.id, code: this.code, name: this.name }; }
  }));
  const currentStatus = statuses.find((status) => status.code === current);
  const writes = { lead: [], activity: [], audit: [], statusCreates: 0, leadLookup: null };
  const events = [];
  const lead = missingLead ? null : {
    id: 55, ownerId, statusId: currentStatus.id, stage: current, convertedAt: null, convertedByUserId: null,
    async update(values, options) { Object.assign(this, values); writes.lead.push({ values, options }); return this; }
  };
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const service = createLeadStatusService({
    sequelize: { async transaction(callback) { return callback(transaction); } },
    Lead: {
      async findByPk(id, options) { writes.leadLookup = options; return lead; }
    },
    LeadStatus: {
      async findByPk(id) { return statuses.find((status) => String(status.id) === String(id)) || null; },
      async findOne({ where }) { return statuses.find((status) => status.code === where.code && status.active === where.active) || null; },
      async create() { writes.statusCreates += 1; }
    },
    LeadActivity: {
      async create(values, options) { if (activityError) throw activityError; writes.activity.push({ values, options }); return { id: 99, ...values }; }
    },
    auditService: {
      async record(values) { if (auditError) throw auditError; writes.audit.push(values); return { id: 88 }; }
    },
    Conversation: { async findAll() { return []; } },
    socketService: { async emitToConversationAudience() {} },
    logger: {
      info(message, metadata) { events.push({ level: 'info', message, metadata }); },
      warn(message, metadata) { events.push({ level: 'warn', message, metadata }); },
      error(message, metadata) { events.push({ level: 'error', message, metadata }); }
    }
  });
  return { service, lead, statuses, writes, events, transaction };
}

const ownActor = { id: 10, isSystemAdmin: false, permissions: ['lead.update_status_own'] };
const managerActor = { id: 20, isSystemAdmin: false, permissions: ['lead.update_status_all'] };

for (const [from, to] of [['new', 'contacted'], ['contacted', 'interested'], ['interested', 'registered']]) {
  test(`${from} -> ${to} updates statusId by stable code`, async () => {
    const env = environment({ current: from });
    const result = await env.service.updateLeadStatus({
      leadId: 55, statusCode: to, expectedCurrentStatusCode: from, actor: ownActor
    });
    const target = env.statuses.find((status) => status.code === to);
    assert.equal(env.lead.statusId, target.id);
    assert.equal(env.writes.lead[0].values.statusId, target.id);
    assert.equal(Object.hasOwn(env.writes.lead[0].values, 'status'), false);
    assert.equal(Object.hasOwn(env.writes.lead[0].values, 'status_code'), false);
    assert.equal(Object.hasOwn(env.writes.lead[0].values, 'leadStatusId'), false);
    assert.deepEqual(result, { id: 55, statusId: target.id, status: { id: target.id, code: to, name: target.name } });
    assert.equal(env.writes.statusCreates, 0);
    assert.equal(env.writes.leadLookup.lock, 'UPDATE');
    assert.equal(Object.hasOwn(env.writes.leadLookup, 'include'), false);
    if (to === 'registered') assert.ok(env.writes.lead[0].values.convertedAt instanceof Date);
  });
}

test('invalid status returns 400 without creating a status', async () => {
  const env = environment();
  await assert.rejects(
    env.service.updateLeadStatus({ leadId: 55, statusCode: 'made_up', actor: ownActor }),
    (error) => error.code === 'INVALID_LEAD_STATUS' && error.status === 400
  );
  assert.equal(env.writes.statusCreates, 0);
});

test('legacy numeric statusId payload resolves to an allowed stable code', async () => {
  const env = environment();
  const interested = env.statuses.find((status) => status.code === 'interested');
  const result = await env.service.updateLeadStatus({ leadId: 55, statusId: interested.id, actor: ownActor });
  assert.equal(result.status.code, 'interested');
  assert.equal(env.writes.statusCreates, 0);
});

test('unauthorized owner update returns 403', async () => {
  const env = environment({ ownerId: 999 });
  await assert.rejects(
    env.service.updateLeadStatus({ leadId: 55, statusCode: 'contacted', actor: ownActor }),
    (error) => error.code === 'LEAD_STATUS_UPDATE_FORBIDDEN' && error.status === 403
  );
});

test('manager can update another owner lead', async () => {
  const env = environment({ ownerId: 999 });
  const result = await env.service.updateLeadStatus({ leadId: 55, statusCode: 'contacted', actor: managerActor });
  assert.equal(result.status.code, 'contacted');
});

test('stale status returns 409 without writing', async () => {
  const env = environment({ current: 'contacted' });
  await assert.rejects(
    env.service.updateLeadStatus({ leadId: 55, statusCode: 'interested', expectedCurrentStatusCode: 'new', actor: ownActor }),
    (error) => error.code === 'STALE_LEAD_STATUS_UPDATE' && error.status === 409
  );
  assert.equal(env.writes.lead.length, 0);
});

test('missing lead returns 404', async () => {
  const env = environment({ missingLead: true });
  await assert.rejects(
    env.service.updateLeadStatus({ leadId: 404, statusCode: 'contacted', actor: managerActor }),
    (error) => error.code === 'LEAD_NOT_FOUND' && error.status === 404
  );
});

test('activity and required audit rows use existing model attributes', async () => {
  const env = environment();
  await env.service.updateLeadStatus({ leadId: 55, statusCode: 'contacted', actor: ownActor });
  assert.deepEqual(Object.keys(env.writes.activity[0].values).sort(), ['action', 'actorUserId', 'leadId', 'newValue', 'note', 'oldValue']);
  assert.equal(env.writes.activity[0].values.actorUserId, ownActor.id);
  assert.equal(env.writes.activity[0].options.transaction, env.transaction);
  assert.equal(env.writes.audit[0].required, true);
  assert.equal(env.writes.audit[0].transaction, env.transaction);
  for (const event of ['lead_status_update_attempt', 'lead_status_update_resolved', 'lead_status_update_saved', 'lead_status_activity_saved']) {
    assert.ok(env.events.some((item) => item.message === event));
  }
});

test('required audit failure is explicit and logged', async () => {
  const env = environment({ auditError: Object.assign(new Error('audit insert failed'), { code: '42703' }) });
  await assert.rejects(
    env.service.updateLeadStatus({ leadId: 55, statusCode: 'contacted', actor: ownActor }),
    (error) => error.code === 'LEAD_STATUS_AUDIT_FAILED' && error.status === 500
  );
  const failure = env.events.find((event) => event.message === 'lead_status_update_failed');
  assert.equal(failure.metadata.oldStatusCode, 'new');
  assert.equal(failure.metadata.newStatusCode, 'contacted');
});

test('activity failure is explicit, logged, and not swallowed', async () => {
  const env = environment({ activityError: Object.assign(new Error('activity insert failed'), { code: '42703' }) });
  await assert.rejects(
    env.service.updateLeadStatus({ leadId: 55, statusCode: 'contacted', actor: ownActor }),
    (error) => error.code === 'LEAD_STATUS_ACTIVITY_FAILED' && error.status === 500
  );
  assert.ok(env.events.some((event) => event.message === 'lead_status_update_failed'));
  assert.equal(env.writes.audit.length, 0);
});

test('payload aliases normalize into one internal status code or id', () => {
  const normalize = leadService.normalizeLeadStatusPayload;
  assert.deepEqual(normalize({ status: 'contacted' }).statusCode, 'contacted');
  assert.deepEqual(normalize({ leadStatus: 'interested' }).statusCode, 'interested');
  assert.deepEqual(normalize({ code: 'registered' }).statusCode, 'registered');
  assert.deepEqual(normalize({ statusId: 'lost' }), { statusCode: 'lost', statusId: undefined, expectedCurrentStatusCode: undefined });
  assert.deepEqual(normalize({ statusId: 7 }), { statusCode: undefined, statusId: 7, expectedCurrentStatusCode: undefined });
});

test('PATCH controller returns the production-compatible updated lead response', async () => {
  const originalUpdateStatus = leadService.updateStatus;
  const expected = { id: '55', statusId: '3', status: { id: '3', code: 'interested', name: 'Interested' } };
  leadService.updateStatus = async (id, payload, actor) => {
    assert.equal(actor.id, 10);
    assert.equal(payload.statusCode, 'interested');
    return expected;
  };
  const response = {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  try {
    await leadController.updateStatus(
      { params: { id: '55' }, body: { statusCode: 'interested', expectedCurrentStatusCode: 'new' }, user: ownActor },
      response,
      (error) => { throw error; }
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { success: true, data: expected });
  } finally {
    leadService.updateStatus = originalUpdateStatus;
  }
});

test('PATCH controller rejects a missing authenticated actor with 401', async () => {
  let nextError;
  await leadController.updateStatus(
    { params: { id: '55' }, body: { statusCode: 'contacted' }, user: null },
    {},
    (error) => { nextError = error; }
  );
  assert.equal(nextError.code, 'AUTH_REQUIRED');
  assert.equal(nextError.status, 401);
});
