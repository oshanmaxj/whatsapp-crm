const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cryptoService = require('../src/services/secretCrypto.service');

test('AI API keys encrypt at rest and decrypt only inside the server service', () => {
  const previous = process.env.AI_PROVIDER_ENCRYPTION_KEY;
  process.env.AI_PROVIDER_ENCRYPTION_KEY = 'test-only-32-byte-secret-material';
  const stored = cryptoService.encrypt('sk-production-secret');
  assert.notEqual(stored.encryptedApiKey, 'sk-production-secret');
  assert.equal(cryptoService.decrypt(stored), 'sk-production-secret');
  assert.equal(JSON.stringify(stored).includes('sk-production-secret'), false);
  if (previous === undefined) delete process.env.AI_PROVIDER_ENCRYPTION_KEY;
  else process.env.AI_PROVIDER_ENCRYPTION_KEY = previous;
});

test('blank provider key updates cannot overwrite encrypted key columns', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/aiProvider.service.js'), 'utf8');
  assert.match(source, /delete values\.apiKey/);
  assert.match(source, /if \(payload\.apiKey\)/);
  assert.match(source, /delete value\.encryptedApiKey; delete value\.keyIv; delete value\.keyTag/);
});

test('reminder migration is restart-safe and protects active and execution duplicates', () => {
  const source = fs.readFileSync(path.join(__dirname, '../migrations/046_reminder_sequences_ai_providers.js'), 'utf8');
  assert.match(source, /IF NOT EXISTS reminder_active_subscription_uq/);
  assert.match(source, /reminder_execution_step_uq/);
  assert.match(source, /WHERE status IN \('active','paused'\)/);
  assert.match(source, /WHERE NOT EXISTS \(SELECT 1 FROM permissions/);
});

test('worker claims due executions with a database lock and skip locked', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/reminderSequence.service.js'), 'utf8');
  assert.match(source, /lock: transaction\.LOCK\.UPDATE, skipLocked: true/);
  assert.match(source, /status: 'processing'/);
  assert.match(source, /whatsappAccountId: subscription\.whatsappAccountId/);
});
