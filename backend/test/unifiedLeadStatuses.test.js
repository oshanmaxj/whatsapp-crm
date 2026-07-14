const test = require('node:test');
const assert = require('node:assert/strict');
const { createUnifiedLeadStatusEnsurer } = require('../src/services/unifiedLeadStatuses.service');
const leadService = require('../src/services/lead.service');
const pipelineService = require('../src/services/pipeline.service');
const leadController = require('../src/controllers/lead.controller');
const { Lead, LeadStatus } = require('../src/models');

function fakeEnvironment(initialRows = []) {
  let nextId = Math.max(0, ...initialRows.map((row) => Number(row.id))) + 1;
  const rows = initialRows.map((values) => makeRow(values));
  let transactionQueue = Promise.resolve();
  const events = [];

  function makeRow(values) {
    return {
      ...values,
      async update(changes) { Object.assign(this, changes); return this; },
      async restore() { this.deletedAt = null; return this; }
    };
  }

  const LeadStatusModel = {
    async findAll() { return rows; },
    async create(values) {
      const row = makeRow({ id: nextId++, ...values });
      return row;
    }
  };
  const sequelize = {
    getDialect: () => 'postgres',
    async query() {},
    transaction(callback) {
      const run = transactionQueue.then(() => callback({ LOCK: { UPDATE: 'UPDATE' } }));
      transactionQueue = run.catch(() => {});
      return run;
    }
  };
  const logger = {
    info(message, metadata) { events.push({ level: 'info', message, metadata }); },
    error(message, metadata) { events.push({ level: 'error', message, metadata }); }
  };
  return { rows, events, ensure: createUnifiedLeadStatusEnsurer({ sequelize, LeadStatus: LeadStatusModel, logger }) };
}

test('empty database creates all seven unified statuses', async () => {
  const env = fakeEnvironment();
  const result = await env.ensure();
  assert.equal(result.length, 7);
  assert.deepEqual(env.rows.map((row) => row.code), ['new', 'contacted', 'interested', 'ignore', 'agreed', 'registered', 'lost']);
});

test('running the initializer twice creates no duplicates', async () => {
  const env = fakeEnvironment();
  await env.ensure();
  const ids = env.rows.map((row) => row.id);
  await env.ensure();
  assert.equal(env.rows.length, 7);
  assert.deepEqual(env.rows.map((row) => row.id), ids);
});

test('existing Interested row with a missing code is updated in place', async () => {
  const env = fakeEnvironment([{ id: 42, name: 'Interested', code: null, active: true }]);
  await env.ensure();
  const interested = env.rows.find((row) => row.code === 'interested');
  assert.equal(interested.id, 42);
  assert.equal(env.rows.filter((row) => row.code === 'interested').length, 1);
});

test('lowercase and whitespace Interested row is normalized and reused', async () => {
  const env = fakeEnvironment([{ id: 9, name: '  interested  ', code: '', active: true }]);
  await env.ensure();
  const interested = env.rows.find((row) => row.id === 9);
  assert.equal(interested.name, 'Interested');
  assert.equal(interested.code, 'interested');
});

test('existing lead foreign-key references remain on the reused row', async () => {
  const env = fakeEnvironment([{ id: 17, name: 'Interested', code: null, active: true }]);
  const lead = { id: 100, statusId: 17 };
  await env.ensure();
  assert.equal(lead.statusId, 17);
  assert.equal(env.rows.find((row) => row.code === 'interested').id, 17);
});

test('concurrent initializer calls create only one row per status', async () => {
  const env = fakeEnvironment();
  await Promise.all([env.ensure(), env.ensure(), env.ensure()]);
  assert.equal(env.rows.length, 7);
  assert.equal(new Set(env.rows.map((row) => row.code)).size, 7);
});

test('conflicting code and normalized-name rows fail without choosing one silently', async () => {
  const env = fakeEnvironment([
    { id: 5, name: 'Legacy interested', code: 'interested', active: true },
    { id: 6, name: ' Interested ', code: null, active: true }
  ]);
  await assert.rejects(env.ensure(), (error) => error.code === 'UNIFIED_LEAD_STATUS_CONFLICT');
  assert.equal(env.rows.find((row) => row.id === 5).name, 'Legacy interested');
  assert.equal(env.rows.find((row) => row.id === 6).code, null);
  assert.ok(env.events.some((event) => event.message === 'unified_lead_status_check_failed'));
});

test('a stable code is not overwritten from an incompatible canonical name', async () => {
  const env = fakeEnvironment([{ id: 8, name: 'Contacted', code: 'interested', active: true }]);
  await assert.rejects(env.ensure(), (error) => error.code === 'UNIFIED_LEAD_STATUS_CONFLICT');
  assert.equal(env.rows[0].code, 'interested');
  assert.equal(env.rows[0].name, 'Contacted');
});

test('unrelated database errors are logged and rethrown', async () => {
  const databaseError = Object.assign(new Error('connection closed'), { code: 'ECONNRESET' });
  const events = [];
  const ensure = createUnifiedLeadStatusEnsurer({
    sequelize: {
      getDialect: () => 'postgres',
      async transaction(callback) { return callback({ LOCK: { UPDATE: 'UPDATE' } }); },
      async query() { throw databaseError; }
    },
    LeadStatus: { async findAll() { return []; } },
    logger: {
      info(message, metadata) { events.push({ level: 'info', message, metadata }); },
      error(message, metadata) { events.push({ level: 'error', message, metadata }); }
    }
  });
  await assert.rejects(ensure(), (error) => error === databaseError);
  assert.ok(events.some((event) => event.message === 'unified_lead_status_check_failed'));
});

test('GET leads service path does not create or initialize statuses', async () => {
  const originalFindAndCountAll = Lead.findAndCountAll;
  const originalCreate = LeadStatus.create;
  let statusCreates = 0;
  Lead.findAndCountAll = async () => ({ count: 0, rows: [] });
  LeadStatus.create = async () => { statusCreates += 1; throw new Error('GET attempted a status insert'); };
  try {
    const result = await leadService.listLeads({ page: 1, limit: 10, dateType: 'createdAt' }, { id: 1, isSystemAdmin: true, permissions: [] });
    assert.equal(result.pagination.total, 0);
    assert.equal(statusCreates, 0);
  } finally {
    Lead.findAndCountAll = originalFindAndCountAll;
    LeadStatus.create = originalCreate;
  }
});

test('Leads controller returns 200 when statuses already exist', async () => {
  const originalList = leadService.listLeads;
  leadService.listLeads = async () => ({ leads: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } });
  const response = {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  try {
    await leadController.list({ query: { page: '1', limit: '10', dateType: 'createdAt' }, user: { id: 1 } }, response, (error) => { throw error; });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
  } finally {
    leadService.listLeads = originalList;
  }
});

test('pipeline stage creation uses a normalized code instead of a name-only insert', async () => {
  const originalFindOne = LeadStatus.findOne;
  const originalCreate = LeadStatus.create;
  let created;
  LeadStatus.findOne = async () => null;
  LeadStatus.create = async (values) => { created = values; return values; };
  try {
    await pipelineService.saveStage(null, { name: '  Follow Up Later  ' }, { isSystemAdmin: true });
    assert.equal(created.name, 'Follow Up Later');
    assert.equal(created.code, 'follow_up_later');
  } finally {
    LeadStatus.findOne = originalFindOne;
    LeadStatus.create = originalCreate;
  }
});

test('pipeline stage creation rejects a normalized name or code duplicate', async () => {
  const originalFindOne = LeadStatus.findOne;
  const originalCreate = LeadStatus.create;
  let createCalled = false;
  LeadStatus.findOne = async () => ({ id: 4, name: 'Interested', code: 'interested' });
  LeadStatus.create = async () => { createCalled = true; };
  try {
    await assert.rejects(
      pipelineService.saveStage(null, { name: ' Interested ' }, { isSystemAdmin: true }),
      (error) => error.code === 'DUPLICATE_PIPELINE_STAGE' && error.status === 409
    );
    assert.equal(createCalled, false);
  } finally {
    LeadStatus.findOne = originalFindOne;
    LeadStatus.create = originalCreate;
  }
});
