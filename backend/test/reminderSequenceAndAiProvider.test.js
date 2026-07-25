const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cryptoService = require('../src/services/secretCrypto.service');
const reminderSequenceService = require('../src/services/reminderSequence.service');
const models = require('../src/models');

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

test('AI provider encryption configuration is explicit and rejects weak keys', () => {
  const previous = process.env.AI_PROVIDER_ENCRYPTION_KEY;
  delete process.env.AI_PROVIDER_ENCRYPTION_KEY;
  assert.throws(() => cryptoService.assertConfigured(), error => error.code === 'AI_ENCRYPTION_KEY_REQUIRED' && error.status === 503);
  process.env.AI_PROVIDER_ENCRYPTION_KEY = 'too-short';
  assert.throws(() => cryptoService.assertConfigured(), error => error.code === 'AI_ENCRYPTION_KEY_INVALID' && error.status === 503);
  if (previous === undefined) delete process.env.AI_PROVIDER_ENCRYPTION_KEY;
  else process.env.AI_PROVIDER_ENCRYPTION_KEY = previous;
});

test('blank provider key updates cannot overwrite encrypted key columns', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/aiProvider.service.js'), 'utf8');
  assert.match(source, /delete values\.apiKey/);
  assert.match(source, /input\.apiKey \? crypto\.encrypt\(input\.apiKey\) : null/);
  assert.match(source, /delete value\.encryptedApiKey; delete value\.keyIv; delete value\.keyTag/);
  assert.match(source, /models\.sequelize\.transaction/);
});

test('reminder migration is restart-safe and protects active and execution duplicates', () => {
  const source = fs.readFileSync(path.join(__dirname, '../migrations/046_reminder_sequences_ai_providers.js'), 'utf8');
  assert.match(source, /check duplicate active reminder subscriptions/);
  assert.match(source, /MIGRATION_DUPLICATES_FOUND/);
  assert.match(source, /reminder_execution_step_uq/);
  assert.match(source, /WHERE status IN \('active','paused'\)/);
  assert.match(source, /WHERE NOT EXISTS \(SELECT 1 FROM permissions/);
  assert.doesNotMatch(source, /\.catch\(\(\)=>null\)/);
});

test('worker claims due executions with a database lock and skip locked', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/reminderSequence.service.js'), 'utf8');
  assert.match(source, /lock: transaction\.LOCK\.UPDATE, skipLocked: true/);
  assert.match(source, /status: 'processing'/);
  assert.match(source, /whatsappAccountId: subscription\.whatsappAccountId/);
});

test('reminder lifecycle publishes valid drafts, pauses, and resumes with canonical statuses', async () => {
  const originalTransaction = models.sequelize.transaction;
  const originalFind = models.ReminderSequence.findByPk;
  const originalFindSteps = models.ReminderSequenceStep.findAll;
  const row = {
    id: 7, name: 'Follow up', status: 'draft',
    steps: [{ stepNumber: 1, delayValue: 1, delayUnit: 'hours', body: 'Hello', templateId: null }],
    update: async values => Object.assign(row, values)
  };
  models.sequelize.transaction = async callback => callback({ LOCK: { UPDATE: 'UPDATE' } });
  models.ReminderSequence.findByPk = async () => row;
  models.ReminderSequenceStep.findAll = async () => row.steps;
  try {
    const activated = await reminderSequenceService.changeSequenceStatus(7, 'ACTIVE', 2);
    assert.equal(row.status, 'active');
    assert.equal(activated.warnings.length, 1);
    await reminderSequenceService.changeSequenceStatus(7, 'paused', 2);
    assert.equal(row.status, 'paused');
    await reminderSequenceService.changeSequenceStatus(7, 'active', 2);
    assert.equal(row.status, 'active');
  } finally {
    models.sequelize.transaction = originalTransaction;
    models.ReminderSequence.findByPk = originalFind;
    models.ReminderSequenceStep.findAll = originalFindSteps;
  }
});

test('publishing rejects invalid steps with field-level errors', async () => {
  const originalTransaction = models.sequelize.transaction;
  const originalFind = models.ReminderSequence.findByPk;
  const originalFindSteps = models.ReminderSequenceStep.findAll;
  const steps = [{ stepNumber: 1, delayValue: 0, delayUnit: 'weeks', body: '' }];
  models.sequelize.transaction = async callback => callback({ LOCK: { UPDATE: 'UPDATE' } });
  models.ReminderSequence.findByPk = async () => ({ id: 8, name: 'Broken', status: 'draft' });
  models.ReminderSequenceStep.findAll = async () => steps;
  try {
    await assert.rejects(
      reminderSequenceService.changeSequenceStatus(8, 'active', 2),
      error => Boolean(error.status === 422 && error.errors['steps.0.delayValue'] && error.errors['steps.0.delayUnit'] && error.errors['steps.0.body'])
    );
  } finally {
    models.sequelize.transaction = originalTransaction;
    models.ReminderSequence.findByPk = originalFind;
    models.ReminderSequenceStep.findAll = originalFindSteps;
  }
});

test('leaderboard uses the canonical lead_status table', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/dashboardAnalytics.service.js'), 'utf8');
  assert.match(source, /LEFT JOIN lead_status ls ON ls\.id = lead\.status_id/);
  assert.doesNotMatch(source, /JOIN lead_statuses/);
});

test('Flow Builder uses active canonical reminder sequences and stores sequence IDs', () => {
  const optionsSource = fs.readFileSync(path.join(__dirname, '../src/services/flow.service.js'), 'utf8');
  const actionSource = fs.readFileSync(path.join(__dirname, '../src/services/flowAction.service.js'), 'utf8');
  assert.match(optionsSource, /ReminderSequence\.findAll/);
  assert.match(optionsSource, /status: 'active'/);
  assert.doesNotMatch(optionsSource, /Sequence\.findAll\(\{ where: \{ status: 'active'/);
  assert.match(actionSource, /reminderSequence\.service'\)\.subscribe/);
  assert.match(actionSource, /sequenceIds/);
});
