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

// Phase 2's webhook tests are not campaign-related — none of these
// sms_messages rows are linked to a campaign recipient, so the Phase 3
// delivery cascade (smsWebhook.service.js -> smsCampaignDelivery.service.js)
// must see no matching row and no-op, exactly like a real non-campaign send.
models.SmsCampaignRecipient.findOne = async () => null;

let smsMessageStore;
let lastFindOneOptions;
models.SmsMessage.findOne = async (options) => {
  lastFindOneOptions = options;
  const { where } = options;
  for (const row of smsMessageStore.values()) {
    if (row.provider === where.provider && row.providerMessageId === where.providerMessageId) {
      if (!row.update) row.update = async (patch) => { Object.assign(row, patch); return row; };
      return row;
    }
  }
  return null;
};

// applyDeliveryEvent() wraps its read-check-write in sequelize.transaction()
// with a row lock — this mock makes the transaction transparent (no real DB)
// while still exercising the real production code path structurally, so we
// can assert it actually asked for the lock (see the concurrency test below).
let transactionCallCount = 0;
models.sequelize.transaction = async (fn) => {
  transactionCallCount += 1;
  return fn({ LOCK: { UPDATE: 'UPDATE' } });
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
  transactionCallCount = 0;
  lastFindOneOptions = undefined;
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

test('out-of-order lifecycle transitions behave as documented', async () => {
  // queued -> sent -> failed: each step ranks higher, both apply; ends failed.
  seedMessage({ id: 10, provider: 'smsgo', providerMessageId: 'MSG-QSF', status: 'queued' });
  await invoke({ event: 'sms.status_update', data: { messageId: 'MSG-QSF', status: 'Sent' } });
  assert.equal(smsMessageStore.get(10).status, 'sent');
  await invoke({ event: 'sms.status_update', data: { messageId: 'MSG-QSF', status: 'Failed', error: 'carrier error' } });
  assert.equal(smsMessageStore.get(10).status, 'failed');

  // queued -> failed -> sent: "sent" arriving after "failed" is a LOWER rank
  // and is ignored; ends failed (failed does not get walked back to sent).
  seedMessage({ id: 11, provider: 'smsgo', providerMessageId: 'MSG-QFS', status: 'queued' });
  await invoke({ event: 'sms.status_update', data: { messageId: 'MSG-QFS', status: 'Failed' } });
  assert.equal(smsMessageStore.get(11).status, 'failed');
  await invoke({ event: 'sms.status_update', data: { messageId: 'MSG-QFS', status: 'Sent' } });
  assert.equal(smsMessageStore.get(11).status, 'failed', 'a stale "sent" arriving after "failed" must not revert the record');

  // sent -> delivered -> failed: delivered is terminal; the later "failed" is dropped.
  seedMessage({ id: 12, provider: 'smsgo', providerMessageId: 'MSG-SDF', status: 'sent' });
  await invoke({ event: 'sms.status_update', data: { messageId: 'MSG-SDF', status: 'Delivered' } });
  assert.equal(smsMessageStore.get(12).status, 'delivered');
  await invoke({ event: 'sms.status_update', data: { messageId: 'MSG-SDF', status: 'Failed' } });
  assert.equal(smsMessageStore.get(12).status, 'delivered', 'delivered must never be overwritten by a later failed event');

  // failed -> delivered: delivered outranks failed and delivered is not the
  // CURRENT status yet, so this is allowed to apply (a provider correcting
  // an earlier failure report to a confirmed delivery).
  seedMessage({ id: 13, provider: 'smsgo', providerMessageId: 'MSG-FD', status: 'failed' });
  await invoke({ event: 'sms.status_update', data: { messageId: 'MSG-FD', status: 'Delivered' } });
  assert.equal(smsMessageStore.get(13).status, 'delivered', 'a later delivered event may still correct an earlier failed report');
});

test('provider + providerMessageId lookup does not cross-match another provider using the same id', async () => {
  seedMessage({ id: 20, provider: 'smsgo', providerMessageId: 'DUPLICATE-ID-ACROSS-PROVIDERS', status: 'sent' });
  seedMessage({ id: 21, provider: 'some-other-provider', providerMessageId: 'DUPLICATE-ID-ACROSS-PROVIDERS', status: 'sent' });

  await invoke({ event: 'sms.status_update', data: { messageId: 'DUPLICATE-ID-ACROSS-PROVIDERS', status: 'Delivered' } });

  assert.equal(smsMessageStore.get(20).status, 'delivered', 'the smsgo-provider row for this id must be updated');
  assert.equal(smsMessageStore.get(21).status, 'sent', "a different provider's row sharing the same raw id string must never be touched");
});

test('an invalid/garbage provider timestamp falls back to the received time instead of corrupting deliveredAt', async () => {
  seedMessage({ id: 30, provider: 'smsgo', providerMessageId: 'MSG-BADTS', status: 'sent' });
  const before = Date.now();
  await invoke({ event: 'sms.status_update', data: { messageId: 'MSG-BADTS', status: 'Delivered', timestamp: 'not-a-real-date' } });
  const record = smsMessageStore.get(30);
  assert.equal(record.status, 'delivered', 'the status transition itself must not be blocked by a bad timestamp');
  assert.ok(record.deliveredAt instanceof Date && !Number.isNaN(record.deliveredAt.getTime()), 'deliveredAt must be a valid Date, never "Invalid Date"');
  assert.ok(record.deliveredAt.getTime() >= before, 'an invalid provider timestamp must fall back to roughly now, not silently pass through as garbage');
});

test('concurrency: applyDeliveryEvent runs its read-check-write inside a locked transaction', async () => {
  seedMessage({ id: 40, provider: 'smsgo', providerMessageId: 'MSG-LOCK', status: 'sent' });
  await invoke({ event: 'sms.status_update', data: { messageId: 'MSG-LOCK', status: 'Delivered' } });
  assert.equal(transactionCallCount, 1, 'the status update must run inside sequelize.transaction()');
  assert.equal(lastFindOneOptions.lock, 'UPDATE', 'the row must be read with a row lock (transaction.LOCK.UPDATE), not a bare unlocked read, so concurrent deliveries for the same message serialize instead of racing past the out-of-order check');
});

test('two concurrent deliveries for the SAME message each run in their own transaction (serialized by the DB lock, not by the app)', async () => {
  seedMessage({ id: 41, provider: 'smsgo', providerMessageId: 'MSG-CONCURRENT', status: 'sent' });
  await Promise.all([
    invoke({ event: 'sms.status_update', data: { messageId: 'MSG-CONCURRENT', status: 'Delivered' } }),
    invoke({ event: 'sms.status_update', data: { messageId: 'MSG-CONCURRENT', status: 'Sent' } })
  ]);
  assert.equal(transactionCallCount, 2, 'each distinct event gets its own transaction/lock acquisition');
  // Whichever order Postgres's real row lock serializes these in, 'delivered'
  // must win over 'sent' once both have been applied, by the same terminal
  // guard already proven above — this just confirms concurrent delivery of
  // two DIFFERENT events for one message still converges on the correct
  // final state rather than depending on request arrival order in-process.
  assert.equal(smsMessageStore.get(41).status, 'delivered');
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

test('webhook.routes.js does not require CRM authentication on any provider webhook (providers cannot log in)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/webhook.routes.js'), 'utf8');
  assert.ok(!/auth\.authenticate|authMiddleware/.test(source), 'webhook.routes.js must not gate provider callbacks behind CRM session auth — they are authenticated only by their own signature scheme');
  assert.ok(source.includes("router.post('/sms', smsWebhookController.receive)"), 'the generic SMS webhook must be mounted');
});
