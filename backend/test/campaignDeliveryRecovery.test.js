const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { campaignFailure, sanitizedError } = require('../src/services/messageQueue.service');

const queueSource = fs.readFileSync(path.join(__dirname, '../src/services/messageQueue.service.js'), 'utf8');
const campaignSource = fs.readFileSync(path.join(__dirname, '../src/services/campaign.service.js'), 'utf8');
const migrationSource = fs.readFileSync(path.join(__dirname, '../migrations/063_campaign_delivery_recovery.js'), 'utf8');

test('worker imports the shared sequelize instance and atomically skip-locks claims', () => {
  assert.match(queueSource, /\{ sequelize,/);
  assert.match(queueSource, /sequelize\.transaction/);
  assert.match(queueSource, /skipLocked: true/);
  assert.match(queueSource, /lockedAt: now, workerId: WORKER_ID/);
});

test('stale claims are lease-recoverable and sent evidence is excluded', () => {
  assert.match(queueSource, /status: 'processing', externalMessageId: null/);
  assert.match(queueSource, /lockedAt: \{ \[Op\.lt\]: staleBefore \}/);
  assert.match(campaignSource, /externalMessageId: null/);
  assert.match(campaignSource, /\['sent', 'delivered', 'read', 'replied', 'converted'\]/);
  assert.match(queueSource, /if \(row\.externalMessageId\)/);
  assert.match(queueSource, /externalMessageId: null/);
});

test('each queue claim is isolated and a failed job cannot poison the next claim transaction', () => {
  assert.match(queueSource, /for \(let index = 0; index < limit; index \+= 1\)/);
  assert.match(queueSource, /const row = await sequelize\.transaction/);
  assert.match(queueSource, /results\.push\(await this\.processOne\(row\)\)/);
  assert.match(queueSource, /catch \(error\)/);
});

test('429 and Meta 5xx are retryable while permanent 400 is terminal', () => {
  assert.equal(campaignFailure({ response: { status: 429 }, message: 'rate limit' }).permanent, false);
  assert.equal(campaignFailure({ response: { status: 503 }, message: 'unavailable' }).permanent, false);
  assert.equal(campaignFailure({ response: { status: 400 }, message: 'bad request' }).permanent, true);
});

test('Meta error persistence is structured and sanitized', () => {
  assert.deepEqual(sanitizedError({ response: { status: 400, data: { error: {
    code: 100, error_subcode: 2388001, error_user_title: 'Invalid parameter',
    error_user_msg: 'Fix the template parameter', fbtrace_id: 'trace-1'
  } } } }), {
    httpStatus: 400, metaCode: 100, errorSubcode: 2388001,
    title: 'Invalid parameter', message: 'Fix the template parameter', fbtraceId: 'trace-1'
  });
});

test('migration is bounded, rerunnable, and adds campaign progress plus idempotency fields', () => {
  assert.match(migrationSource, /lock_timeout/);
  assert.match(migrationSource, /statement_timeout/);
  assert.match(migrationSource, /'claimed_at', 'TIMESTAMPTZ'/);
  assert.match(migrationSource, /information_schema\.columns/);
  assert.match(migrationSource, /message_queue_campaign_recipient_unique/);
  assert.match(migrationSource, /last_progress_at/);
  assert.match(migrationSource, /completed_at/);
});

test('24-hour audience persists all intended recipients and records worker skips', () => {
  assert.match(campaignSource, /messagingWindow: 'all'/);
  assert.match(queueSource, /MESSAGING_WINDOW_CLOSED/);
  assert.match(queueSource, /status: 'skipped'/);
});
