'use strict';
// Exercises the REAL generic webhook controller -> factory -> SmsGoProvider
// path end to end; only the DB boundary (AppSetting row, SmsWebhookEvent,
// SmsMessage) and the audit log are mocked, so signature verification,
// idempotent claiming, provider status mapping, and out-of-order protection
// all run as real production code, not stubs.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.APP_SETTINGS_ENCRYPTION_KEY = process.env.APP_SETTINGS_ENCRYPTION_KEY || 'unit-test-encryption-key-32-bytes!!';

const settingsService = require('../src/services/smsGatewaySettings.service');
const auditService = require('../src/services/audit.service');
const models = require('../src/models');
const smsWebhookController = require('../src/controllers/smsWebhook.controller');
const permission = require('../src/middleware/permission.middleware');

const API_KEY = 'sandbox-webhook-test-key';

auditService.record = async () => {}; // no real AuditLog DB write

let fakeSettingsRow;
settingsService.row = async () => ({
  get id() { return fakeSettingsRow.id; },
  get value() { return fakeSettingsRow.value; },
  async update(patch) { if (patch.value !== undefined) fakeSettingsRow.value = patch.value; return this; }
});

let webhookEventStore;
models.SmsWebhookEvent.create = async (attrs) => {
  if (webhookEventStore.has(attrs.eventKey)) {
    throw Object.assign(new Error('duplicate key value violates unique constraint'), { name: 'SequelizeUniqueConstraintError' });
  }
  const row = { ...attrs, id: webhookEventStore.size + 1 };
  webhookEventStore.set(attrs.eventKey, row);
  return row;
};
models.SmsWebhookEvent.update = async (patch, { where: { eventKey } }) => {
  const row = webhookEventStore.get(eventKey);
  if (!row) return [0];
  Object.assign(row, patch);
  return [1];
};

let smsMessageStore;
models.SmsMessage.findOne = async ({ where }) => {
  for (const row of smsMessageStore.values()) {
    if (row.provider === where.provider && row.providerMessageId === where.providerMessageId) {
      if (!row.update) row.update = async (patch) => { Object.assign(row, patch); return row; };
      return row;
    }
  }
  return null;
};

function seedMessage(row) {
  smsMessageStore.set(row.id, { ...row });
}

async function resetGatewayState() {
  fakeSettingsRow = { id: 1, value: {} };
  await settingsService.save({
    isEnabled: true, activeProvider: 'smsgo',
    providerConfig: { mode: 'sandbox', sandboxApiKey: API_KEY, liveApiKey: '', defaultMask: 'TESTMASK' }
  });
}

test.beforeEach(async () => {
  webhookEventStore = new Map();
  smsMessageStore = new Map();
  await resetGatewayState();
});

function sign(bodyObject) {
  const rawBody = Buffer.from(JSON.stringify(bodyObject));
  return crypto.createHmac('sha256', API_KEY).update(rawBody).digest('hex');
}

function invoke(bodyObject, { signature = sign(bodyObject) } = {}) {
  return new Promise((resolve) => {
    const rawBody = Buffer.from(JSON.stringify(bodyObject));
    const req = { body: bodyObject, headers: signature ? { 'x-smsgo-signature': signature } : {}, rawBody };
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { resolve({ status: this.statusCode, body: payload }); }
    };
    smsWebhookController.receive(req, res);
  });
}

test('valid webhook: correctly-signed delivered event updates the matching sms_messages record', async () => {
  seedMessage({ id: 1, provider: 'smsgo', providerMessageId: 'MSG-DELIVERED', status: 'sent' });
  const payload = { event: 'sms.status_update', data: { messageId: 'MSG-DELIVERED', status: 'Delivered', to: '94771234567', timestamp: '2026-01-01T00:00:00.000Z' } };
  const { status, body } = await invoke(payload);
  assert.equal(status, 200);
  assert.equal(body.success, true);
  const record = smsMessageStore.get(1);
  assert.equal(record.status, 'delivered');
  assert.ok(record.deliveredAt, 'deliveredAt must be set');
  assert.equal(record.providerStatus, 'Delivered', 'raw provider status text preserved separately from the normalized status');
});

test('failed status: a failed event sets status, failedAt and errorMessage', async () => {
  seedMessage({ id: 2, provider: 'smsgo', providerMessageId: 'MSG-FAILED', status: 'sent' });
  const payload = { event: 'sms.status_update', data: { messageId: 'MSG-FAILED', status: 'Undelivered', error: 'handset unreachable', to: '94771234567' } };
  const { status } = await invoke(payload);
  assert.equal(status, 200);
  const record = smsMessageStore.get(2);
  assert.equal(record.status, 'failed');
  assert.ok(record.failedAt);
  assert.equal(record.errorMessage, 'handset unreachable');
});

test('invalid signature is rejected with 401 and never claimed in the idempotency ledger', async () => {
  seedMessage({ id: 3, provider: 'smsgo', providerMessageId: 'MSG-BADSIG', status: 'sent' });
  const payload = { event: 'sms.status_update', data: { messageId: 'MSG-BADSIG', status: 'Delivered' } };
  const { status, body } = await invoke(payload, { signature: 'not-the-real-signature' });
  assert.equal(status, 401);
  assert.equal(body.success, false);
  assert.equal(webhookEventStore.size, 0, 'a rejected signature must not be recorded as a claimed/received event');
  assert.equal(smsMessageStore.get(3).status, 'sent', 'an unsigned/forged event must never mutate a message record');
});

test('duplicate webhook delivery is ignored idempotently on the second delivery', async () => {
  seedMessage({ id: 4, provider: 'smsgo', providerMessageId: 'MSG-DUP', status: 'sent' });
  const payload = { event: 'sms.status_update', data: { messageId: 'MSG-DUP', status: 'Delivered', to: '94771234567' } };
  const signature = sign(payload);

  const first = await invoke(payload, { signature });
  assert.equal(first.status, 200);
  assert.equal(first.body.duplicate, undefined);
  assert.equal(webhookEventStore.size, 1);

  const second = await invoke(payload, { signature });
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true, 'the exact same delivery must be recognized as a duplicate');
  assert.equal(webhookEventStore.size, 1, 'no second ledger row should be created for a duplicate delivery');
});

test('unknown providerMessageId: a valid, well-signed event with no matching local record is a safe no-op', async () => {
  const payload = { event: 'sms.status_update', data: { messageId: 'MSG-NEVER-SENT-BY-US', status: 'Delivered' } };
  const { status, body } = await invoke(payload);
  assert.equal(status, 200, 'a valid signed event must still return 200 even when unmatched');
  assert.equal(body.success, true);
  const ledgerRow = [...webhookEventStore.values()][0];
  assert.equal(ledgerRow.status, 'processed');
  assert.match(ledgerRow.errorDetails || '', /no_matching_sms_message/);
});

test('out-of-order status protection: a delivered message is not downgraded by a later, older-ranked event', async () => {
  seedMessage({ id: 5, provider: 'smsgo', providerMessageId: 'MSG-ORDER', status: 'sent' });

  const delivered = { event: 'sms.status_update', data: { messageId: 'MSG-ORDER', status: 'Delivered', to: '94771234567' } };
  await invoke(delivered);
  assert.equal(smsMessageStore.get(5).status, 'delivered');

  // A stale "sent" event redelivered/arriving late after "delivered" was
  // already applied must not regress the record.
  const staleSent = { event: 'sms.status_update', data: { messageId: 'MSG-ORDER', status: 'Sent', to: '94771234567', timestamp: '2020-01-01T00:00:00.000Z' } };
  const { status } = await invoke(staleSent);
  assert.equal(status, 200);
  assert.equal(smsMessageStore.get(5).status, 'delivered', 'a delivered message must never be downgraded by an out-of-order intermediate status');
});

// ---------- Authorization (permission-middleware boundary, matching the
// existing callCenterAuthorizationBoundary.test.js style) ----------
function invokePermission(code, user) {
  return new Promise((resolve) => {
    const req = { user };
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(body) { resolve({ status: this.statusCode, body }); } };
    permission(code)(req, res, () => resolve({ status: 200 }));
  });
}

test('a user without sms.view is rejected by the permission boundary', async () => {
  const user = { id: 1, isSystemAdmin: false, permissions: ['dashboard.view'] };
  const result = await invokePermission('sms.view', user);
  assert.equal(result.status, 403);
});

test('a user with sms.view passes the permission boundary', async () => {
  const user = { id: 2, isSystemAdmin: false, permissions: ['sms.view'] };
  const result = await invokePermission('sms.view', user);
  assert.equal(result.status, 200);
});

test('sms.routes.js declares sms.view on both history routes and sms.send on the send route', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/sms.routes.js'), 'utf8');
  assert.ok(source.includes("permit('sms.send')"), 'POST /send must require sms.send');
  assert.ok(/get\('\/messages',\s*permit\('sms\.view'\)/.test(source), 'GET /messages must require sms.view');
  assert.ok(/get\('\/messages\/:id',\s*permit\('sms\.view'\)/.test(source), 'GET /messages/:id must require sms.view');
});
