'use strict';
// Verifies the provider-boundary normalization added for the balance/mask
// UX polish: smsgo.provider.js must be the only place that ever parses
// SMSGo's raw response shapes, and it must translate SMSGo's specific
// "mask not approved" wording into a generic, provider-neutral error the
// rest of the CRM can react to without knowing anything about SMSGo.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.APP_SETTINGS_ENCRYPTION_KEY = process.env.APP_SETTINGS_ENCRYPTION_KEY || 'unit-test-encryption-key-32-bytes!!';

const SmsGoProvider = require('../src/services/sms/providers/smsgo.provider');

function providerWithFakeHttp({ get, post } = {}) {
  const provider = new SmsGoProvider({ mode: 'sandbox', sandboxApiKey: 'fake-key' });
  provider.client = () => ({
    get: get || (async () => { throw new Error('unexpected GET in this test'); }),
    post: post || (async () => { throw new Error('unexpected POST in this test'); })
  });
  return provider;
}

function axiosError(status, data) {
  return Object.assign(new Error('Request failed'), { response: { status, data } });
}

test('getBalance() normalizes SMSGo\'s real production envelope into { balance, currency }', async () => {
  const provider = providerWithFakeHttp({
    get: async () => ({ data: { success: true, data: { balance: 3000, currency: 'LKR' } } })
  });
  const result = await provider.getBalance();
  assert.deepEqual(result, { balance: 3000, currency: 'LKR' });
});

test('getBalance() defensively handles a flatter response shape (no nested data envelope)', async () => {
  const provider = providerWithFakeHttp({ get: async () => ({ data: { balance: 500 } }) });
  const result = await provider.getBalance();
  assert.deepEqual(result, { balance: 500, currency: null });
});

test('getBalance() never returns the raw response object', async () => {
  const provider = providerWithFakeHttp({
    get: async () => ({ data: { success: true, data: { balance: 3000, currency: 'LKR' } } })
  });
  const result = await provider.getBalance();
  assert.equal('success' in result, false, 'the {success:true,...} envelope must not leak through');
  assert.equal('data' in result, false, 'the nested "data" wrapper must not leak through');
});

test('getSenderMasks() normalizes a { data: [...] } envelope of plain strings', async () => {
  const provider = providerWithFakeHttp({ get: async () => ({ data: { data: ['MASK_ONE', 'MASK_TWO'] } }) });
  assert.deepEqual(await provider.getSenderMasks(), ['MASK_ONE', 'MASK_TWO']);
});

test('getSenderMasks() normalizes a { masks: [...] } envelope of objects', async () => {
  const provider = providerWithFakeHttp({ get: async () => ({ data: { masks: [{ mask: 'ALPHA' }, { name: 'BETA' }] } }) });
  assert.deepEqual(await provider.getSenderMasks(), ['ALPHA', 'BETA']);
});

test('getSenderMasks() returns an empty array (not an error) when none are approved yet', async () => {
  const provider = providerWithFakeHttp({ get: async () => ({ data: { data: [] } }) });
  assert.deepEqual(await provider.getSenderMasks(), []);
});

test('sendSms() translates SMSGo\'s "mask not approved" wording into a generic, provider-neutral error', async () => {
  const provider = providerWithFakeHttp({
    post: async () => { throw axiosError(422, { message: 'Mask "First Of Ed" not approved. Available masks: ' }); }
  });
  await assert.rejects(
    () => provider.sendSms({ to: '0771234567', message: 'hi', mask: 'First Of Ed' }),
    (error) => {
      assert.equal(error.code, 'SENDER_MASK_NOT_APPROVED');
      assert.equal(error.message, 'SMS could not be sent because the selected sender mask is not approved by the SMS provider.');
      assert.match(error.technicalMessage, /First Of Ed/, 'the original provider wording must be preserved for diagnostics');
      assert.equal(error.status, 422);
      return true;
    }
  );
});

test('sendSms() leaves unrelated provider errors untranslated (message and technicalMessage both the raw text)', async () => {
  const provider = providerWithFakeHttp({
    post: async () => { throw axiosError(422, { message: 'Insufficient account balance.' }); }
  });
  await assert.rejects(
    () => provider.sendSms({ to: '0771234567', message: 'hi' }),
    (error) => {
      assert.equal(error.code, 'SMSGO_REQUEST_FAILED');
      assert.equal(error.message, 'Insufficient account balance.');
      assert.equal(error.technicalMessage, 'Insufficient account balance.');
      return true;
    }
  );
});

// ---------- End to end through smsMessage.service.js: SMS History keeps the
// technical detail; the immediate API response/UI alert gets the clean one.
test('a failed test SMS is recorded in SMS History with the technical message, while the clean message is what gets re-thrown', async () => {
  const models = require('../src/models');
  const smsService = require('../src/services/sms/sms.service');
  const auditService = require('../src/services/audit.service');
  const smsMessageService = require('../src/services/smsMessage.service');

  auditService.record = async () => {};
  const created = {};
  models.SmsMessage.create = async (attrs) => {
    Object.assign(created, attrs);
    created.update = async (patch) => Object.assign(created, patch);
    return created;
  };

  const cleanMessage = 'SMS could not be sent because the selected sender mask is not approved by the SMS provider.';
  const originalSendSms = smsService.sendSms;
  smsService.sendSms = async () => {
    throw Object.assign(new Error(cleanMessage), {
      status: 422, code: 'SENDER_MASK_NOT_APPROVED', provider: 'smsgo',
      technicalMessage: 'Mask "First Of Ed" not approved. Available masks: '
    });
  };

  try {
    await assert.rejects(
      () => smsMessageService.sendSingle({ to: '0771234567', message: 'hi', mask: 'First Of Ed' }, { id: 1 }),
      (error) => { assert.equal(error.message, cleanMessage); return true; }
    );
    assert.equal(created.status, 'failed');
    assert.equal(created.provider, 'smsgo');
    assert.match(created.errorMessage, /First Of Ed/, 'SMS History must keep the full technical/provider wording for diagnostics');
    assert.notEqual(created.errorMessage, cleanMessage, 'the stored diagnostic message should be the technical one, not a duplicate of the clean user-facing one');
  } finally {
    smsService.sendSms = originalSendSms;
  }
});
