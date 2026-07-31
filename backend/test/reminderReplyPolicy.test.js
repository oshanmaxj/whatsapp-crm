const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { replySchedule } = require('../src/services/reminderSequence.service');

test('postpone policy uses the later of existing due time and reply cooldown', () => {
  const reply = new Date('2026-08-01T00:00:00Z');
  const result = replySchedule({ receivedAt: reply, existingNextRunAt: '2026-08-01T02:00:00Z', value: 4, unit: 'hours' });
  assert.equal(result.resumeAt.toISOString(), '2026-08-01T04:00:00.000Z');
  assert.equal(result.nextRunAt.toISOString(), '2026-08-01T04:00:00.000Z');
});

test('a later reply extends cooldown without changing step order', () => {
  const first = replySchedule({ receivedAt: '2026-08-01T00:00:00Z', value: 4, unit: 'hours' });
  const second = replySchedule({ receivedAt: '2026-08-01T03:00:00Z', existingNextRunAt: first.nextRunAt, value: 4, unit: 'hours' });
  assert.equal(second.nextRunAt.toISOString(), '2026-08-01T07:00:00.000Z');
});

test('migration and inbound hook preserve history, idempotency and explicit button priority', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../migrations/057_reminder_reply_policy.js'), 'utf8');
  const inbound = fs.readFileSync(path.join(__dirname, '../src/services/inboundWhatsappMessage.service.js'), 'utf8');
  const service = fs.readFileSync(path.join(__dirname, '../src/services/reminderSequence.service.js'), 'utf8');
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /WHERE status IN \('active','paused'\)/);
  assert.match(inbound, /applyRecipientReply/);
  assert.match(service, /lastRecipientReplyMessageId === String\(whatsappMessageId\)/);
  assert.match(service, /explicit\.sequenceBehavior/);
  assert.match(service, /stepNumber: \{ \[Op\.gt\]: subscription\.currentStep \}/);
});
