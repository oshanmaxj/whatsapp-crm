'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.APP_SETTINGS_ENCRYPTION_KEY = process.env.APP_SETTINGS_ENCRYPTION_KEY || 'unit-test-encryption-key-32-bytes!!';

const models = require('../src/models');
const auditService = require('../src/services/audit.service');
const audienceService = require('../src/services/smsCampaignAudience.service');
const settingsService = require('../src/services/smsGatewaySettings.service');
const service = require('../src/services/smsCampaign.service');
const permission = require('../src/middleware/permission.middleware');

auditService.record = async () => {};
audienceService.resolve = async () => ({
  recipients: [{ phone: '94771234567', name: 'Test', contactId: 1, leadId: null, studentId: null, matchedEntities: [{ type: 'contact', id: 1 }] }],
  invalid: [], totalValid: 1, totalInvalid: 0, duplicatesRemoved: 0
});
settingsService.getRuntimeConfig = async () => ({ isEnabled: true, activeProvider: 'smsgo', providerConfig: { mode: 'sandbox', defaultMask: 'TESTMASK' } });
settingsService.getPublicMetadata = async () => ({ activeProvider: 'smsgo', providerConfig: { mode: 'sandbox', defaultMask: 'TESTMASK' }, capabilities: { balance: false, masks: true, bulk: true, sandbox: true } });

// Serializes concurrent sequelize.transaction() calls FIFO, mimicking how a
// real Postgres row lock (transaction.LOCK.UPDATE) forces a second,
// double-submitted launch to wait for the first to commit before it can
// even read the (by-then-updated) campaign status.
let transactionQueue = Promise.resolve();
models.sequelize.transaction = (fn) => {
  const run = transactionQueue.then(() => fn({ LOCK: { UPDATE: 'UPDATE' } }));
  transactionQueue = run.catch(() => {});
  return run;
};

function makeCampaignStore(initial) {
  const row = { ...initial };
  row.update = async (patch) => { Object.assign(row, patch); return row; };
  row.destroy = async () => { row.destroyed = true; };
  row.reload = async () => row;
  row.increment = async (field, { by = 1 } = {}) => { row[field] = (row[field] || 0) + by; return row; };
  return row;
}

test('create() validates required fields and recipient source', async () => {
  await assert.rejects(() => service.create({}, { id: 1 }), (error) => { assert.equal(error.code, 'VALIDATION_FAILED'); return true; });
  await assert.rejects(() => service.create({ name: 'X', message: 'Y', recipientSource: 'bogus' }, { id: 1 }));
});

test('create() persists a draft campaign', async () => {
  let created = null;
  models.SmsCampaign.create = async (attrs) => { created = makeCampaignStore({ id: 1, ...attrs }); return created; };
  const campaign = await service.create({ name: 'Promo', message: 'Hi {{name}}', recipientSource: 'manual', audienceConfig: { phoneNumbers: '0771234567' } }, { id: 9 });
  assert.equal(campaign.status, 'draft');
  assert.equal(campaign.name, 'Promo');
});

test('update() rejects editing an active campaign', async () => {
  models.SmsCampaign.findByPk = async () => makeCampaignStore({ id: 2, status: 'queued' });
  await assert.rejects(() => service.update(2, { name: 'x' }, { id: 1 }), (error) => { assert.equal(error.code, 'SMS_CAMPAIGN_NOT_EDITABLE'); return true; });
});

test('remove() rejects deleting an active campaign but allows deleting a draft', async () => {
  models.SmsCampaign.findByPk = async () => makeCampaignStore({ id: 3, status: 'running' });
  await assert.rejects(() => service.remove(3, { id: 1 }), (error) => { assert.equal(error.code, 'SMS_CAMPAIGN_NOT_DELETABLE'); return true; });

  const draft = makeCampaignStore({ id: 4, status: 'draft' });
  models.SmsCampaign.findByPk = async () => draft;
  const result = await service.remove(4, { id: 1 });
  assert.equal(result.deleted, true);
  assert.equal(draft.destroyed, true);
});

test('launch() Send Now moves a draft straight to queued and snapshots provider/mode', async () => {
  const campaign = makeCampaignStore({ id: 5, status: 'draft', mode: null, provider: null, senderMask: null });
  models.SmsCampaign.findByPk = async () => campaign;
  models.SmsCampaignRecipient.count = async () => 1;
  models.SmsCampaignRecipient.bulkCreate = async () => {};
  const result = await service.launch(5, {}, { id: 1 });
  assert.equal(result.campaign.status, 'queued');
  assert.equal(result.campaign.provider, 'smsgo');
  assert.equal(result.campaign.mode, 'sandbox');
  assert.equal(result.campaign.senderMask, 'TESTMASK', 'falls back to the gateway default mask when the campaign has none set');
});

test('launch() with a future scheduledAt sets status to scheduled, not queued', async () => {
  const campaign = makeCampaignStore({ id: 6, status: 'draft' });
  models.SmsCampaign.findByPk = async () => campaign;
  models.SmsCampaignRecipient.count = async () => 1;
  models.SmsCampaignRecipient.bulkCreate = async () => {};
  const future = new Date(Date.now() + 3600000).toISOString();
  const result = await service.launch(6, { scheduledAt: future }, { id: 1 });
  assert.equal(result.campaign.status, 'scheduled');
});

test('launch() throws SMS_CAMPAIGN_NO_RECIPIENTS when the audience resolves to nothing', async () => {
  const campaign = makeCampaignStore({ id: 7, status: 'draft' });
  models.SmsCampaign.findByPk = async () => campaign;
  models.SmsCampaignRecipient.count = async () => 0;
  models.SmsCampaignRecipient.bulkCreate = async () => {};
  await assert.rejects(() => service.launch(7, {}, { id: 1 }), (error) => { assert.equal(error.code, 'SMS_CAMPAIGN_NO_RECIPIENTS'); return true; });
  assert.equal(campaign.status, 'failed', 'a launch that cannot proceed must not leave the campaign stuck mid-transition');
});

test('duplicate Send Now: a double-submitted launch only succeeds once', async () => {
  const campaign = makeCampaignStore({ id: 8, status: 'draft' });
  models.SmsCampaign.findByPk = async () => campaign;
  models.SmsCampaignRecipient.count = async () => 1;
  models.SmsCampaignRecipient.bulkCreate = async () => {};

  const [first, second] = await Promise.allSettled([
    service.launch(8, {}, { id: 1 }),
    service.launch(8, {}, { id: 1 })
  ]);
  const outcomes = [first, second];
  const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
  const rejected = outcomes.filter((o) => o.status === 'rejected');
  assert.equal(fulfilled.length, 1, 'exactly one of the two simultaneous Send Now clicks must succeed');
  assert.equal(rejected.length, 1, 'the other must be rejected, not silently duplicate the send');
  assert.equal(rejected[0].reason.code, 'SMS_CAMPAIGN_ALREADY_LAUNCHED');
});

test('sandbox/live isolation: launch() snapshots the mode active at launch time', async () => {
  settingsService.getRuntimeConfig = async () => ({ isEnabled: true, activeProvider: 'smsgo', providerConfig: { mode: 'live', defaultMask: 'LIVEMASK' } });
  const campaign = makeCampaignStore({ id: 9, status: 'draft' });
  models.SmsCampaign.findByPk = async () => campaign;
  models.SmsCampaignRecipient.count = async () => 1;
  models.SmsCampaignRecipient.bulkCreate = async () => {};
  const result = await service.launch(9, {}, { id: 1 });
  assert.equal(result.campaign.mode, 'live');
  settingsService.getRuntimeConfig = async () => ({ isEnabled: true, activeProvider: 'smsgo', providerConfig: { mode: 'sandbox', defaultMask: 'TESTMASK' } }); // restore
});

test('launch() refuses to launch while SMS sending is disabled at the gateway', async () => {
  settingsService.getRuntimeConfig = async () => ({ isEnabled: false, activeProvider: 'smsgo', providerConfig: { mode: 'sandbox' } });
  const campaign = makeCampaignStore({ id: 10, status: 'draft' });
  models.SmsCampaign.findByPk = async () => campaign;
  await assert.rejects(() => service.launch(10, {}, { id: 1 }), (error) => { assert.equal(error.code, 'SMS_GATEWAY_DISABLED'); return true; });
  settingsService.getRuntimeConfig = async () => ({ isEnabled: true, activeProvider: 'smsgo', providerConfig: { mode: 'sandbox', defaultMask: 'TESTMASK' } }); // restore
});

test('pause()/resume() only work from the expected states', async () => {
  const draft = makeCampaignStore({ id: 11, status: 'draft' });
  models.SmsCampaign.findByPk = async () => draft;
  await assert.rejects(() => service.pause(11, { id: 1 }), (error) => { assert.equal(error.code, 'SMS_CAMPAIGN_NOT_PAUSABLE'); return true; });

  const running = makeCampaignStore({ id: 12, status: 'running' });
  models.SmsCampaign.findByPk = async () => running;
  const paused = await service.pause(12, { id: 1 });
  assert.equal(paused.status, 'paused');
  assert.ok(paused.pausedAt);

  models.SmsCampaign.findByPk = async () => running;
  const resumed = await service.resume(12, { id: 1 });
  assert.equal(resumed.status, 'queued');
  assert.equal(resumed.pausedAt, null);
});

test('cancel() marks the campaign cancelled and marks only still-queued recipients cancelled, preserving history', async () => {
  const campaign = makeCampaignStore({ id: 13, status: 'running' });
  models.SmsCampaign.findByPk = async () => campaign;
  let updateCall = null;
  models.SmsCampaignRecipient.update = async (patch, options) => { updateCall = { patch, options }; return [3]; };
  const result = await service.cancel(13, { id: 1 });
  assert.equal(result.status, 'cancelled');
  assert.ok(result.cancelledAt);
  assert.deepEqual(updateCall.patch, { status: 'cancelled' });
  assert.deepEqual(updateCall.options.where, { campaignId: 13, status: 'queued' });
});

test('retryEligible() only requeues failed, non-permanent, not-yet-accepted-by-provider recipients', async () => {
  const campaign = makeCampaignStore({ id: 14, status: 'completed' });
  models.SmsCampaign.findByPk = async () => campaign;
  let updateCall = null;
  models.SmsCampaignRecipient.update = async (patch, options) => { updateCall = { patch, options }; return [2]; };
  const result = await service.retryEligible(14, { id: 1 });
  assert.equal(result.requeued, 2);
  assert.equal(updateCall.options.where.status, 'failed');
  assert.equal(updateCall.options.where.providerMessageId, null, 'must never touch a recipient already accepted by the provider');
  assert.equal(campaign.status, 'queued', 'a completed campaign with requeued recipients must resume processing');
});

test('list() and listRecipients() are server-side paginated with a bounded page size', async () => {
  let lastListOptions = null;
  models.SmsCampaign.findAndCountAll = async (options) => { lastListOptions = options; return { rows: [], count: 137 }; };
  const list = await service.list({ page: 2, pageSize: 25 });
  assert.equal(lastListOptions.limit, 25);
  assert.equal(lastListOptions.offset, 25);
  assert.equal(list.totalPages, Math.ceil(137 / 25));

  models.SmsCampaign.findByPk = async () => makeCampaignStore({ id: 15, status: 'draft' });
  let lastRecipientOptions = null;
  models.SmsCampaignRecipient.findAndCountAll = async (options) => { lastRecipientOptions = options; return { rows: [], count: 4321 }; };
  await service.listRecipients(15, { pageSize: 5000 });
  assert.equal(lastRecipientOptions.limit, 100, 'recipient pagination must also be bounded — never load thousands into one response');
});

// ---------- Permissions ----------
function invokePermission(code, user) {
  return new Promise((resolve) => {
    const req = { user };
    const res = { statusCode: 200, status(value) { this.statusCode = value; return this; }, json(body) { resolve({ status: this.statusCode, body }); } };
    permission(code)(req, res, () => resolve({ status: 200 }));
  });
}

test('sms_campaigns permissions are enforced and not granted to an unrelated role by default', async () => {
  const unrelatedUser = { id: 1, isSystemAdmin: false, permissions: ['dashboard.view'] };
  for (const code of ['sms_campaigns.view', 'sms_campaigns.create', 'sms_campaigns.send', 'sms_campaigns.manage']) {
    const result = await invokePermission(code, unrelatedUser);
    assert.equal(result.status, 403, `${code} must not be granted to an unrelated role`);
  }
  const campaignManager = { id: 2, isSystemAdmin: false, permissions: ['sms_campaigns.view', 'sms_campaigns.send'] };
  assert.equal((await invokePermission('sms_campaigns.view', campaignManager)).status, 200);
  assert.equal((await invokePermission('sms_campaigns.send', campaignManager)).status, 200);
  assert.equal((await invokePermission('sms_campaigns.manage', campaignManager)).status, 403);
});

test('smsCampaign.routes.js declares the expected permission on every route', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '../src/routes/smsCampaign.routes.js'), 'utf8');
  assert.ok(/get\('\/', permit\('sms_campaigns\.view'\)/.test(source));
  assert.ok(/post\('\/', permit\('sms_campaigns\.create'\)/.test(source));
  assert.ok(/post\('\/:id\/send', permit\('sms_campaigns\.send'\)/.test(source));
  assert.ok(/post\('\/:id\/schedule', permit\('sms_campaigns\.send'\)/.test(source));
  for (const action of ['pause', 'resume', 'cancel', 'retry']) {
    assert.ok(source.includes(`permit('sms_campaigns.manage')`), `${action} route must require sms_campaigns.manage`);
  }
});
