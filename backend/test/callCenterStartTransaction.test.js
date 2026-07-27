const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const service = require('../src/services/callCenter.service');

const actor = { id: 4, permissions: ['calls.create'] };

function patchStartEnvironment(overrides = {}) {
  const originals = {
    transaction: db.sequelize.transaction,
    lead: db.Lead.findByPk,
    contact: db.Contact.findByPk,
    findCall: db.CallActivity.findOne,
    createCall: db.CallActivity.create,
    createActivity: db.LeadActivity.create
  };
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  let callsCreated = 0;
  db.sequelize.transaction = async callback => callback(transaction);
  db.Lead.findByPk = overrides.lead || (async (id, options) => {
    assert.equal(String(id), '1209');
    assert.equal(options.lock, 'UPDATE');
    assert.equal(options.include, undefined);
    return { id: 1209, contactId: 1294, ownerId: 4, statusId: 2, whatsappAccountId: 7 };
  });
  db.Contact.findByPk = async id => {
    assert.equal(String(id), '1294');
    return { id: 1294, phone: '+94770000000' };
  };
  db.CallActivity.findOne = async () => null;
  db.CallActivity.create = async values => {
    callsCreated += 1;
    assert.equal(values.leadId, 1209);
    assert.equal(values.contactId, 1294);
    assert.equal(values.agentUserId, 4);
    return { id: 800, ...values };
  };
  db.LeadActivity.create = async () => ({ id: 900 });
  return {
    callsCreated: () => callsCreated,
    restore() {
      db.sequelize.transaction = originals.transaction;
      db.Lead.findByPk = originals.lead;
      db.Contact.findByPk = originals.contact;
      db.CallActivity.findOne = originals.findCall;
      db.CallActivity.create = originals.createCall;
      db.LeadActivity.create = originals.createActivity;
    }
  };
}

test('production-shaped Start Call locks only lead 1209 and loads contact 1294 separately', async () => {
  const env = patchStartEnvironment();
  try {
    const row = await service.start({ leadId: 1209, method: 'manual' }, actor, { requestId: 'test-request' });
    assert.equal(row.id, 800);
    assert.equal(env.callsCreated(), 1);
  } finally {
    env.restore();
  }
});

test('Start Call immediately preserves and rethrows the original PostgreSQL exception', async () => {
  const original = Object.assign(new Error('FOR UPDATE cannot be applied to the nullable side of an outer join'), {
    original: { code: '0A000', message: 'FOR UPDATE cannot be applied to the nullable side of an outer join' }
  });
  const env = patchStartEnvironment({ lead: async () => { throw original; } });
  try {
    await assert.rejects(
      service.start({ leadId: 1209, method: 'manual' }, actor, { requestId: 'test-original-error' }),
      error => error === original
    );
    assert.equal(env.callsCreated(), 0);
  } finally {
    env.restore();
  }
});
