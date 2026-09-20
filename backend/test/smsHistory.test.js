'use strict';
// Tests smsMessage.service.js's list() filter-building and server-side
// pagination math directly, by capturing the arguments it passes to
// SmsMessage.findAndCountAll() rather than hitting a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.APP_SETTINGS_ENCRYPTION_KEY = process.env.APP_SETTINGS_ENCRYPTION_KEY || 'unit-test-encryption-key-32-bytes!!';

const models = require('../src/models');
const smsMessageService = require('../src/services/smsMessage.service');

let lastCall;
models.SmsMessage.findAndCountAll = async (options) => {
  lastCall = options;
  return { rows: [{ id: 1 }], count: 137 };
};

test('list() with no filters defaults to page 1 / pageSize 25 and no where clauses', async () => {
  const result = await smsMessageService.list();
  assert.deepEqual(lastCall.where, {});
  assert.equal(lastCall.limit, 25);
  assert.equal(lastCall.offset, 0);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 25);
  assert.equal(result.total, 137);
  assert.equal(result.totalPages, Math.ceil(137 / 25));
});

test('list() filters by status', async () => {
  await smsMessageService.list({ status: 'delivered' });
  assert.equal(lastCall.where.status, 'delivered');
});

test('list() filters by provider', async () => {
  await smsMessageService.list({ provider: 'smsgo' });
  assert.equal(lastCall.where.provider, 'smsgo');
});

test('list() filters by phone using a sanitized partial match', async () => {
  await smsMessageService.list({ phone: '077-123-4567' });
  const clause = lastCall.where.toNumber[Op.iLike];
  assert.equal(clause, '%0771234567%', 'non-digit characters must be stripped before matching');
});

test('list() filters by date range (inclusive gte/lte)', async () => {
  await smsMessageService.list({ dateFrom: '2026-01-01', dateTo: '2026-01-31' });
  assert.ok(lastCall.where.createdAt[Op.gte] instanceof Date);
  assert.ok(lastCall.where.createdAt[Op.lte] instanceof Date);
});

test('list() combines multiple filters in one where clause', async () => {
  await smsMessageService.list({ status: 'failed', provider: 'smsgo', phone: '0771234567' });
  assert.equal(lastCall.where.status, 'failed');
  assert.equal(lastCall.where.provider, 'smsgo');
  assert.ok(lastCall.where.toNumber);
});

test('list() pagination: page/pageSize map to the correct limit and offset', async () => {
  await smsMessageService.list({ page: 3, pageSize: 10 });
  assert.equal(lastCall.limit, 10);
  assert.equal(lastCall.offset, 20);
});

test('list() pagination: pageSize is capped at 100 even if a larger value is requested', async () => {
  await smsMessageService.list({ pageSize: 5000 });
  assert.equal(lastCall.limit, 100, 'must not allow loading the entire table via an unbounded page size');
});

test('list() pagination: page is floored at 1 for zero/negative input', async () => {
  const result = await smsMessageService.list({ page: 0 });
  assert.equal(lastCall.offset, 0);
  assert.equal(result.page, 1);

  await smsMessageService.list({ page: -5 });
  assert.equal(lastCall.offset, 0);
});

test('list() always orders by createdAt DESC and never removes the limit (server-side pagination, never the full table)', async () => {
  await smsMessageService.list({});
  assert.deepEqual(lastCall.order, [['createdAt', 'DESC']]);
  assert.ok(Number.isFinite(lastCall.limit) && lastCall.limit > 0, 'a bounded limit must always be present');
});

test('getById() throws SMS_MESSAGE_NOT_FOUND for a missing id', async () => {
  models.SmsMessage.findByPk = async () => null;
  await assert.rejects(() => smsMessageService.getById(999999), (error) => error.code === 'SMS_MESSAGE_NOT_FOUND' && error.status === 404);
});

test('getById() redacts providerMetadata through the generic secret scrubber', async () => {
  models.SmsMessage.findByPk = async () => ({
    toJSON: () => ({ id: 1, providerMetadata: { rawStatus: 'DELIVRD', raw: { authorization: 'Bearer should-not-appear', status: 'DELIVRD' } } })
  });
  const result = await smsMessageService.getById(1);
  assert.equal(JSON.stringify(result.providerMetadata).includes('should-not-appear'), false);
});

test('getById() redacts apiKey/signature-shaped keys the generic scrubber alone would miss', async () => {
  models.SmsMessage.findByPk = async () => ({
    toJSON: () => ({
      id: 2,
      providerMetadata: {
        raw: {
          apiKey: 'sandbox-secret-should-never-appear',
          'X-API-Key': 'another-secret-should-never-appear',
          signature: 'hmac-signature-should-never-appear',
          nested: { api_key: 'nested-secret-should-never-appear' },
          status: 'DELIVRD',
          to: '94771234567'
        }
      }
    })
  });
  const result = await smsMessageService.getById(2);
  const serialized = JSON.stringify(result.providerMetadata);
  for (const secret of ['sandbox-secret-should-never-appear', 'another-secret-should-never-appear', 'hmac-signature-should-never-appear', 'nested-secret-should-never-appear']) {
    assert.equal(serialized.includes(secret), false, `${secret} must be redacted`);
  }
  // Non-sensitive fields must survive — this is a targeted redaction, not a wipe.
  assert.equal(result.providerMetadata.raw.status, 'DELIVRD');
  assert.equal(result.providerMetadata.raw.to, '94771234567');
});
