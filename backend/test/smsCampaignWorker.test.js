'use strict';
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
const settingsService = require('../src/services/smsGatewaySettings.service');
const smsService = require('../src/services/sms/sms.service');
const smsCampaignDeliveryService = require('../src/services/smsCampaignDelivery.service');
const worker = require('../src/services/smsCampaignWorker.service');

settingsService.getRuntimeConfig = async () => ({ isEnabled: true, activeProvider: 'smsgo', providerConfig: { mode: 'sandbox', defaultMask: 'TESTMASK' } });

// ---------- A small, faithful evaluator for the exact Sequelize operators
// the worker's claim query uses (Op.in/Op.or/Op.lte/Op.lt) — this exercises
// the REAL where-clause the worker builds, rather than a hand-duplicated
// approximation of it that could silently drift out of sync.
function allKeys(obj) { return [...Object.keys(obj), ...Object.getOwnPropertySymbols(obj)]; }
function matchesCondition(value, condition) {
  if (condition === null) return value == null;
  if (Array.isArray(condition)) return condition.includes(value);
  if (condition && typeof condition === 'object' && !(condition instanceof Date)) {
    return allKeys(condition).every((opKey) => {
      const opValue = condition[opKey];
      if (opKey === Op.in) return opValue.includes(value);
      if (opKey === Op.lte) return value != null && value <= opValue;
      if (opKey === Op.lt) return value != null && value < opValue;
      return true;
    });
  }
  return value === condition;
}
function matchesWhere(row, where) {
  return allKeys(where).every((key) => {
    if (key === Op.and) return where[key].every((c) => matchesWhere(row, c));
    if (key === Op.or) return where[key].some((c) => matchesWhere(row, c));
    return matchesCondition(row[key], where[key]);
  });
}

let transactionQueue = Promise.resolve();
models.sequelize.transaction = (fn) => {
  const run = transactionQueue.then(() => fn({ LOCK: { UPDATE: 'UPDATE' } }));
  transactionQueue = run.catch(() => {});
  return run;
};

let campaignStore;
let recipientStore;
let nextRecipientId;

function makeRow(store) {
  store.update = async (patch) => { Object.assign(store, patch); return store; };
  store.reload = async () => store;
  store.increment = async (field, { by = 1 } = {}) => { store[field] = (store[field] || 0) + by; return store; };
  store.decrement = async (field, { by = 1 } = {}) => { store[field] = (store[field] || 0) - by; return store; };
  return store;
}

function seedCampaign(attrs) {
  const row = makeRow({ sentCount: 0, failedCount: 0, deliveredCount: 0, rejectedCount: 0, queuedCount: 0, ...attrs });
  campaignStore.set(row.id, row);
  return row;
}
function seedRecipient(attrs) {
  const row = makeRow({ attempts: 0, maxAttempts: 3, status: 'queued', ...attrs });
  recipientStore.set(row.id, row);
  return row;
}

models.SmsCampaign.findAll = async (options) => [...campaignStore.values()].filter((row) => matchesWhere(row, options.where));
models.SmsCampaign.findByPk = async (id) => campaignStore.get(Number(id)) || null;
models.SmsCampaignRecipient.findOne = async (options) => {
  const candidates = [...recipientStore.values()].filter((row) => matchesWhere(row, options.where)).sort((a, b) => a.id - b.id);
  return candidates[0] || null;
};
let createdMessages;
models.SmsMessage.create = async (attrs) => { const row = { id: createdMessages.length + 1, ...attrs }; createdMessages.push(row); return row; };
// Default for maybeCompleteCampaign()'s remaining-recipients check; tests
// that specifically exercise campaign completion override this locally.
models.SmsCampaignRecipient.count = async (options) => [...recipientStore.values()].filter((row) => row.campaignId === options.where.campaignId && ['queued', 'processing'].includes(row.status)).length;

test.beforeEach(() => {
  campaignStore = new Map();
  recipientStore = new Map();
  createdMessages = [];
  nextRecipientId = 1;
});

test('claimNextRecipient() claims a queued recipient of a queued/running campaign and marks it processing', async () => {
  seedCampaign({ id: 1, status: 'queued', mode: 'sandbox' });
  const recipient = seedRecipient({ id: nextRecipientId++, campaignId: 1, status: 'queued' });
  const claimed = await worker.claimNextRecipient();
  assert.equal(claimed.id, recipient.id);
  assert.equal(claimed.status, 'processing');
  assert.ok(claimed.claimedAt);
  assert.equal(claimed.attempts, 1);
});

test('claimNextRecipient() never claims a recipient belonging to a draft/paused/completed campaign', async () => {
  seedCampaign({ id: 2, status: 'paused' });
  seedRecipient({ id: nextRecipientId++, campaignId: 2, status: 'queued' });
  assert.equal(await worker.claimNextRecipient(), null);
});

test('concurrency-safe claiming: two consecutive claims never return the same recipient', async () => {
  seedCampaign({ id: 3, status: 'queued' });
  const a = seedRecipient({ id: nextRecipientId++, campaignId: 3, status: 'queued' });
  const b = seedRecipient({ id: nextRecipientId++, campaignId: 3, status: 'queued' });
  const [first, second] = await Promise.all([worker.claimNextRecipient(), worker.claimNextRecipient()]);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(new Set([first.id, second.id]), new Set([a.id, b.id]));
});

test('a stale "processing" recipient (worker crashed mid-send) is reclaimed after the lease window', async () => {
  seedCampaign({ id: 4, status: 'running' });
  const staleClaim = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago, well past the lease
  seedRecipient({ id: nextRecipientId++, campaignId: 4, status: 'processing', claimedAt: staleClaim, attempts: 1 });
  const claimed = await worker.claimNextRecipient();
  assert.ok(claimed, 'a stuck recipient past the lease window must be reclaimable');
  assert.equal(claimed.attempts, 2);
});

test('provider-accepted send creates a linked sms_messages row and marks the recipient sent', async () => {
  const campaign = seedCampaign({ id: 5, status: 'running', message: 'Hello', mode: 'sandbox' });
  const recipient = seedRecipient({ id: nextRecipientId++, campaignId: 5, status: 'processing', phone: '94771234567', personalizedMessage: 'Hello there' });
  smsService.sendSms = async () => ({ provider: 'smsgo', providerMessageId: 'MSG-1', providerStatus: 'submitted', mask: 'TESTMASK', raw: { mode: 'sandbox' } });

  const outcome = await worker.processRecipient(recipient);
  assert.equal(outcome.outcome, 'sent');
  assert.equal(recipient.status, 'sent');
  assert.equal(recipient.smsMessageId, 1);
  assert.equal(createdMessages[0].source, 'campaign');
  assert.equal(createdMessages[0].toNumber, '94771234567');
  assert.equal(campaign.sentCount, 1);
});

test('a transient failure is retried with exponential backoff, up to maxAttempts', async () => {
  const campaign = seedCampaign({ id: 6, status: 'running' });
  const recipient = seedRecipient({ id: nextRecipientId++, campaignId: 6, status: 'processing', phone: '94771234567', attempts: 1, maxAttempts: 3 });
  smsService.sendSms = async () => { throw Object.assign(new Error('SMSGo temporarily unavailable.'), { status: 502, code: 'SMSGO_UNREACHABLE' }); };

  const outcome = await worker.processRecipient(recipient);
  assert.equal(outcome.outcome, 'retrying');
  assert.equal(recipient.status, 'retrying');
  assert.ok(recipient.nextAttemptAt instanceof Date && recipient.nextAttemptAt.getTime() > Date.now());
  assert.equal(recipient.isPermanentFailure, false);
  assert.equal(campaign.failedCount, 0, 'a retrying recipient must not be counted as failed yet');
});

test('a permanent failure (sender mask not approved) never retries, regardless of remaining attempts', async () => {
  const campaign = seedCampaign({ id: 7, status: 'running' });
  const recipient = seedRecipient({ id: nextRecipientId++, campaignId: 7, status: 'processing', phone: '94771234567', attempts: 1, maxAttempts: 3 });
  smsService.sendSms = async () => {
    throw Object.assign(new Error('SMS could not be sent because the selected sender mask is not approved by the SMS provider.'), {
      status: 422, code: 'SENDER_MASK_NOT_APPROVED', technicalMessage: 'Mask "First Of Ed" not approved. Available masks: '
    });
  };

  const outcome = await worker.processRecipient(recipient);
  assert.equal(outcome.outcome, 'failed');
  assert.equal(outcome.permanent, true);
  assert.equal(recipient.status, 'failed');
  assert.equal(recipient.isPermanentFailure, true);
  assert.equal(recipient.nextAttemptAt, undefined, 'a permanent failure must not schedule a retry');
  assert.equal(campaign.failedCount, 1);
});

test('a transient failure that exhausts maxAttempts is marked failed, not retried forever', async () => {
  const campaign = seedCampaign({ id: 8, status: 'running' });
  const recipient = seedRecipient({ id: nextRecipientId++, campaignId: 8, status: 'processing', phone: '94771234567', attempts: 3, maxAttempts: 3 });
  smsService.sendSms = async () => { throw Object.assign(new Error('Network timeout'), { status: 0, code: 'SMSGO_UNREACHABLE' }); };
  const outcome = await worker.processRecipient(recipient);
  assert.equal(outcome.outcome, 'failed');
  assert.equal(recipient.status, 'failed');
  assert.equal(campaign.failedCount, 1);
});

test('already-provider-accepted recipient is never re-sent, even if reclaimed', async () => {
  seedCampaign({ id: 9, status: 'running' });
  const recipient = seedRecipient({ id: nextRecipientId++, campaignId: 9, status: 'processing', providerMessageId: 'MSG-ALREADY' });
  let sendCalled = false;
  smsService.sendSms = async () => { sendCalled = true; return {}; };
  const outcome = await worker.processRecipient(recipient);
  assert.equal(outcome.outcome, 'already_sent');
  assert.equal(sendCalled, false, 'the provider must never be called again for an already-accepted recipient');
  assert.equal(recipient.status, 'sent');
});

test('a cancelled campaign never sends a claimed recipient, and marks it cancelled instead', async () => {
  seedCampaign({ id: 10, status: 'cancelled' });
  const recipient = seedRecipient({ id: nextRecipientId++, campaignId: 10, status: 'processing' });
  let sendCalled = false;
  smsService.sendSms = async () => { sendCalled = true; return {}; };
  const outcome = await worker.processRecipient(recipient);
  assert.equal(outcome.outcome, 'cancelled');
  assert.equal(sendCalled, false);
  assert.equal(recipient.status, 'cancelled');
});

test('sandbox/live isolation: the worker pauses a campaign rather than send under a changed gateway mode', async () => {
  const campaign = seedCampaign({ id: 11, status: 'running', mode: 'sandbox' });
  const recipient = seedRecipient({ id: nextRecipientId++, campaignId: 11, status: 'processing' });
  settingsService.getRuntimeConfig = async () => ({ isEnabled: true, activeProvider: 'smsgo', providerConfig: { mode: 'live' } });
  let sendCalled = false;
  smsService.sendSms = async () => { sendCalled = true; return {}; };

  const outcome = await worker.processRecipient(recipient);
  assert.equal(outcome.outcome, 'paused_mode_mismatch');
  assert.equal(sendCalled, false, 'must never silently send under live credentials for a sandbox-launched campaign');
  assert.equal(campaign.status, 'paused');
  assert.ok(campaign.lastError.includes('sandbox'));
  assert.equal(recipient.status, 'queued', 'the claim must be released, not left stuck processing');

  settingsService.getRuntimeConfig = async () => ({ isEnabled: true, activeProvider: 'smsgo', providerConfig: { mode: 'sandbox', defaultMask: 'TESTMASK' } }); // restore
});

test('discoverDueScheduledCampaigns() flips a due scheduled campaign to queued, and leaves a not-yet-due one alone', async () => {
  const due = seedCampaign({ id: 12, status: 'scheduled', scheduledAt: new Date(Date.now() - 1000) });
  const notDue = seedCampaign({ id: 13, status: 'scheduled', scheduledAt: new Date(Date.now() + 3600000) });
  await worker.discoverDueScheduledCampaigns();
  assert.equal(due.status, 'queued');
  assert.equal(notDue.status, 'scheduled');
});

// ---------- Delivery webhook -> campaign recipient + counters ----------
test('onSmsMessageStatusChanged() moves the counter bucket and updates the linked recipient', async () => {
  const campaign = seedCampaign({ id: 14, status: 'running', sentCount: 1 });
  const recipient = seedRecipient({ id: nextRecipientId++, campaignId: 14, status: 'sent', smsMessageId: 55 });
  const fakeTransaction = { LOCK: { UPDATE: 'UPDATE' } };
  // For this focused unit test, point the SmsCampaignRecipient/SmsCampaign
  // finders used specifically by the delivery cascade at the same in-memory
  // store (findOne-by-smsMessageId and findByPk are exercised separately
  // from the claim-query mocks above).
  models.SmsCampaignRecipient.findOne = async (options) => {
    if (options.where.smsMessageId !== undefined) return recipientStore.get(recipient.id);
    const candidates = [...recipientStore.values()].filter((row) => matchesWhere(row, options.where)).sort((a, b) => a.id - b.id);
    return candidates[0] || null;
  };

  const result = await smsCampaignDeliveryService.onSmsMessageStatusChanged(
    { smsMessageId: 55, status: 'delivered', timestamp: new Date(), error: null },
    fakeTransaction
  );
  assert.equal(result.updated, true);
  assert.equal(recipient.status, 'delivered');
  assert.ok(recipient.deliveredAt);
  assert.equal(campaign.sentCount, 0, 'must decrement the old bucket');
  assert.equal(campaign.deliveredCount, 1, 'must increment the new bucket');
});

test('onSmsMessageStatusChanged() completes the campaign once no recipients remain queued/processing', async () => {
  const campaign = seedCampaign({ id: 15, status: 'running', sentCount: 1 });
  const recipient = seedRecipient({ id: nextRecipientId++, campaignId: 15, status: 'sent', smsMessageId: 66 });
  models.SmsCampaignRecipient.findOne = async (options) => {
    if (options.where.smsMessageId !== undefined) return recipientStore.get(recipient.id);
    return null;
  };

  await smsCampaignDeliveryService.onSmsMessageStatusChanged({ smsMessageId: 66, status: 'delivered', timestamp: new Date() }, { LOCK: { UPDATE: 'UPDATE' } });
  assert.equal(campaign.status, 'completed');
  assert.ok(campaign.completedAt);
});
