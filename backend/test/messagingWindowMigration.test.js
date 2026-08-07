const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('messaging-window migration is locked, transactional and idempotent', () => {
  const source = fs.readFileSync(path.join(__dirname, '../migrations/058_messaging_window_campaign_audience.js'), 'utf8');
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /SET LOCAL lock_timeout/);
  assert.match(source, /SET LOCAL statement_timeout/);
  assert.match(source, /IF NOT EXISTS/);
  assert.match(source, /transaction\.commit/);
  assert.match(source, /transaction\.rollback/);
  assert.match(source, /conversation_id, whatsapp_account_id, created_at DESC/);
});
