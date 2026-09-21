const test = require('node:test');
const assert = require('node:assert/strict');
const { SmsMessage } = require('../src/models');
const smsMessageService = require('../src/services/smsMessage.service');
const smsService = require('../src/services/sms/sms.service');

const originals = {
  create: SmsMessage.create,
  findOne: SmsMessage.findOne,
  sendSms: smsService.sendSms
};

test.afterEach(() => {
  SmsMessage.create = originals.create;
  SmsMessage.findOne = originals.findOne;
  smsService.sendSms = originals.sendSms;
});

function fakeRecord(initial) {
  const record = { ...initial };
  record.update = async (fields) => { Object.assign(record, fields); return record; };
  return record;
}

test('sendAutomated throws a clear programming error if called without a dedupeKey (never silently sends unguarded automatic SMS)', async () => {
  await assert.rejects(
    smsMessageService.sendAutomated({ to: '0771234567', message: 'hi', source: 'student_welcome_sms' }),
    /dedupeKey is required/
  );
});

test('sendAutomated never throws for an invalid phone number — returns a skipped status instead', async () => {
  const result = await smsMessageService.sendAutomated({ dedupeKey: 'k1', to: 'not-a-phone', message: 'hi', source: 'student_welcome_sms' });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'invalid_phone');
});

test('sendAutomated skips an empty message body without throwing', async () => {
  const result = await smsMessageService.sendAutomated({ dedupeKey: 'k2', to: '0771234567', message: '   ', source: 'student_welcome_sms' });
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'empty_message');
});

test('sendAutomated normalizes the phone, claims the dedupe row, sends, and marks the record sent', async () => {
  let createArgs = null;
  SmsMessage.create = async (data) => { createArgs = data; return fakeRecord({ id: 501, ...data }); };
  smsService.sendSms = async () => ({ provider: 'smsgo', providerMessageId: 'PM-1', providerStatus: 'accepted', segments: 1, cost: 0.5, raw: { ok: true } });

  const result = await smsMessageService.sendAutomated({
    dedupeKey: 'welcome:1:abc', to: '0771234567', message: 'Welcome!', source: 'student_welcome_sms', studentId: 1, contactId: 2
  });

  assert.equal(createArgs.toNumber, '94771234567');
  assert.equal(createArgs.dedupeKey, 'welcome:1:abc');
  assert.equal(result.status, 'sent');
  assert.equal(result.record.status, 'sent');
  assert.equal(result.record.providerMessageId, 'PM-1');
});

test('sendAutomated claiming a dedupeKey that already exists returns duplicate instead of sending again', async () => {
  const uniqueError = Object.assign(new Error('duplicate key'), { name: 'SequelizeUniqueConstraintError' });
  SmsMessage.create = async () => { throw uniqueError; };
  let sendCalled = false;
  smsService.sendSms = async () => { sendCalled = true; return {}; };
  SmsMessage.findOne = async ({ where }) => {
    assert.equal(where.dedupeKey, 'birthday:1:2026');
    return fakeRecord({ id: 900, status: 'sent', dedupeKey: 'birthday:1:2026' });
  };

  const result = await smsMessageService.sendAutomated({
    dedupeKey: 'birthday:1:2026', to: '0771234567', message: 'Happy Birthday', source: 'birthday_wish_sms', studentId: 1
  });

  assert.equal(result.status, 'duplicate');
  assert.equal(result.record.id, 900);
  assert.equal(sendCalled, false, 'the provider must never be called for an already-claimed dedupe key');
});

test('sendAutomated never throws when the provider send fails — records the failure and returns status failed', async () => {
  SmsMessage.create = async (data) => fakeRecord({ id: 777, ...data });
  smsService.sendSms = async () => { throw Object.assign(new Error('Gateway timeout'), { provider: 'smsgo' }); };

  const result = await smsMessageService.sendAutomated({
    dedupeKey: 'class-reminder:9', to: '0771234567', message: 'Class soon', source: 'class_reminder_sms', studentId: 1
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'send_failed');
  assert.equal(result.record.status, 'failed');
  assert.equal(result.record.errorMessage, 'Gateway timeout');
});

test('sendAutomated normalizes every documented phone shape to the same canonical number', async () => {
  const captured = [];
  SmsMessage.create = async (data) => { captured.push(data.toNumber); return fakeRecord({ id: 1, ...data }); };
  smsService.sendSms = async () => ({ provider: 'smsgo' });

  await smsMessageService.sendAutomated({ dedupeKey: 'a', to: '0771234567', message: 'x', source: 's' });
  await smsMessageService.sendAutomated({ dedupeKey: 'b', to: '94771234567', message: 'x', source: 's' });
  await smsMessageService.sendAutomated({ dedupeKey: 'c', to: '+94771234567', message: 'x', source: 's' });

  assert.deepEqual(captured, ['94771234567', '94771234567', '94771234567']);
});
