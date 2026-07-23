const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { sequelize, WhatsAppAccount } = require('../src/models');
const auditService = require('../src/services/audit.service');
const service = require('../src/services/whatsappAccount.service');

const originals = {
  transaction: sequelize.transaction,
  findByPk: WhatsAppAccount.findByPk,
  findOne: WhatsAppAccount.findOne,
  count: WhatsAppAccount.count,
  create: WhatsAppAccount.create,
  audit: auditService.record,
  axiosGet: axios.get
};

test.afterEach(() => {
  sequelize.transaction = originals.transaction;
  WhatsAppAccount.findByPk = originals.findByPk;
  WhatsAppAccount.findOne = originals.findOne;
  WhatsAppAccount.count = originals.count;
  WhatsAppAccount.create = originals.create;
  auditService.record = originals.audit;
  axios.get = originals.axiosGet;
});

function account(overrides = {}) {
  const row = {
    id: 41,
    name: 'Support number',
    phoneNumber: '+94 77 123 4567',
    phoneNumberId: '123456789',
    status: 'inactive',
    connectionStatus: 'inactive',
    sendEnabled: false,
    isDefault: false,
    accessTokenEncrypted: service.encrypt('saved-token'),
    webhookVerifyToken: 'saved-verify-token',
    appSecretEncrypted: service.encrypt('saved-app-secret'),
    apiVersion: 'v25.0',
    apiBaseUrl: 'https://graph.facebook.com',
    ...overrides
  };
  row.update = async (values) => { Object.assign(row, values); return row; };
  row.reload = async () => row;
  row.toJSON = () => Object.fromEntries(Object.entries(row).filter(([, value]) => typeof value !== 'function'));
  return row;
}

function transactionStub() {
  sequelize.transaction = async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } });
}

test('deactivate then reactivate preserves the same account and writes audit records without secrets', async () => {
  const row = account({ status: 'active', connectionStatus: 'connected', sendEnabled: true });
  const existingConversation = { id: 77, whatsappAccountId: row.id };
  const audits = [];
  transactionStub();
  WhatsAppAccount.findByPk = async () => row;
  WhatsAppAccount.findOne = async () => null;
  auditService.record = async (entry) => { audits.push(entry); };

  const deactivated = await service.deactivate(row.id, 9);
  assert.equal(deactivated.status, 'inactive');
  assert.equal(row.id, 41);

  const reactivated = await service.reactivate(row.id, {}, 9);
  assert.equal(reactivated.status, 'active');
  assert.equal(reactivated.connectionStatus, 'disconnected');
  assert.equal(row.id, 41);
  assert.equal(existingConversation.whatsappAccountId, row.id);
  assert.deepEqual(audits.map(({ action }) => action), ['WHATSAPP_ACCOUNT_DEACTIVATED', 'WHATSAPP_ACCOUNT_REACTIVATED']);
  assert.equal(JSON.stringify(audits).includes('saved-token'), false);
  assert.equal(JSON.stringify(reactivated).includes('saved-token'), false);
  assert.equal('accessTokenEncrypted' in reactivated, false);
  assert.equal('webhookVerifyToken' in reactivated, false);
  assert.equal('appSecretEncrypted' in reactivated, false);
});

test('adding an inactive Phone Number ID returns reactivation metadata and creates no duplicate', async () => {
  const row = account();
  let created = false;
  WhatsAppAccount.findOne = async () => row;
  WhatsAppAccount.create = async () => { created = true; };

  await assert.rejects(
    service.create({ name: 'Duplicate', phoneNumberId: row.phoneNumberId, accessToken: 'new-token' }, 9),
    (error) => error.code === 'WHATSAPP_ACCOUNT_INACTIVE'
      && error.details.accountId === row.id
      && error.details.canReactivate === true
  );
  assert.equal(created, false);
});

test('another active owner blocks reactivation of the same Phone Number ID', async () => {
  const row = account();
  transactionStub();
  WhatsAppAccount.findByPk = async () => row;
  WhatsAppAccount.findOne = async () => account({ id: 99, status: 'active' });

  await assert.rejects(
    service.reactivate(row.id, {}, 9),
    { code: 'WHATSAPP_PHONE_NUMBER_ALREADY_ACTIVE' }
  );
  assert.equal(row.status, 'inactive');
});

test('reactivation with a valid new token verifies and returns sanitized account data', async () => {
  const row = account();
  transactionStub();
  WhatsAppAccount.findByPk = async () => row;
  WhatsAppAccount.findOne = async () => null;
  auditService.record = async () => {};
  axios.get = async () => ({ data: { id: row.phoneNumberId, display_phone_number: row.phoneNumber, verified_name: 'Support' } });

  const result = await service.reactivate(row.id, { accessToken: 'valid-new-token' }, 9);
  assert.equal(result.status, 'active');
  assert.equal(result.connectionStatus, 'connected');
  assert.equal(JSON.stringify(result).includes('valid-new-token'), false);
});

test('invalid token keeps the reactivated account disconnected with a useful token status', async () => {
  const row = account();
  transactionStub();
  WhatsAppAccount.findByPk = async () => row;
  WhatsAppAccount.findOne = async () => null;
  auditService.record = async () => {};
  axios.get = async () => {
    const error = new Error('Unauthorized');
    error.response = { status: 401, data: { error: { code: 190 } } };
    throw error;
  };

  await assert.rejects(
    service.reactivate(row.id, { accessToken: 'invalid-new-token' }, 9),
    (error) => error.code === 'WHATSAPP_CONNECTION_FAILED' && /invalid or expired/i.test(error.message)
  );
  assert.equal(row.status, 'active');
  assert.equal(row.connectionStatus, 'token_expired');
  assert.equal(JSON.stringify(row.connectionError).includes('invalid-new-token'), false);
});
