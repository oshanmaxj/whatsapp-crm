const test = require('node:test');
const assert = require('node:assert/strict');

test('label names are trimmed and normalized', () => {
  const { normalizedName } = require('../src/services/label.service');
  assert.equal(normalizedName('  Physical   Workshop  '), 'Physical Workshop');
});

test('label mutation requires the explicit permission', () => {
  const { assertPermission } = require('../src/services/label.service');
  assert.throws(() => assertPermission({ permissions: [] }, 'labels.create'), (error) => error.status === 403 && error.code === 'LABEL_PERMISSION_DENIED');
  assert.doesNotThrow(() => assertPermission({ permissions: ['labels.create'] }, 'labels.create'));
});

test('template parameters are validated in Meta order/count', () => {
  const { validateTemplateComponents } = require('../src/services/chat.service');
  const template = { body: 'Hello {{1}}, course {{2}}', headerType: 'NONE' };
  assert.throws(() => validateTemplateComponents(template, []), (error) => error.code === 'TEMPLATE_PARAMETER_COUNT_INVALID');
  assert.equal(validateTemplateComponents(template, [{ type: 'body', parameters: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] }]).length, 1);
});

test('Meta 131048 gets a clear non-generic message', () => {
  const { templateSendError } = require('../src/services/chat.service');
  assert.match(templateSendError({ code: 131048 }), /Meta temporarily blocked/i);
  assert.match(templateSendError({ code: 131048 }), /quality limits/i);
});

test('unsupported audio MIME is rejected explicitly', async () => {
  const service = require('../src/services/audioProcessing.service');
  await assert.rejects(service.prepare({ filePath: 'unused.wav', mimeType: 'audio/wav' }), (error) => error.status === 415 && error.code === 'AUDIO_MIME_UNSUPPORTED');
});

test('Meta-supported audio MIME remains an audio upload', async () => {
  const service = require('../src/services/audioProcessing.service');
  assert.deepEqual(await service.prepare({ filePath: 'voice.m4a', mimeType: 'audio/m4a' }), { filePath: 'voice.m4a', mimeType: 'audio/mp4' });
});

test('CRM migration can run twice without duplicate indexes', async () => {
  const migration = require('../migrations/042_crm_labels_voice_dashboard');
  const indexes = new Map();
  const queryInterface = {
    sequelize: { transaction: async (callback) => callback({}), query: async () => [] },
    showIndex: async (table) => indexes.get(table) || [],
    addIndex: async (table, fields, options) => indexes.set(table, [...(indexes.get(table) || []), { name: options.name, fields }])
  };
  await migration.up(queryInterface, {});
  const firstCount = [...indexes.values()].flat().length;
  await migration.up(queryInterface, {});
  assert.equal([...indexes.values()].flat().length, firstCount);
});

test('leaderboard uses competition ranks for tied scores', () => {
  const { scoreAndRank } = require('../src/services/dashboardAnalytics.service');
  const rows = [
    { agent: { name: 'A' }, conversionRate: 50, followupCompletionRate: 50, uniqueConversations: 5, revenueAttributed: 100, convertedLeads: 2 },
    { agent: { name: 'B' }, conversionRate: 50, followupCompletionRate: 50, uniqueConversations: 5, revenueAttributed: 100, convertedLeads: 2 },
    { agent: { name: 'C' }, conversionRate: 10, followupCompletionRate: 10, uniqueConversations: 1, revenueAttributed: 0, convertedLeads: 1 }
  ];
  scoreAndRank(rows);
  assert.deepEqual(rows.map((row) => row.rank), [1, 1, 3]);
});

test('custom leaderboard range uses Colombo day boundaries', () => {
  const { rangeDates } = require('../src/services/dashboardAnalytics.service');
  const range = rangeDates('custom', '2026-07-01', '2026-07-02');
  assert.equal(range.start.toISOString(), '2026-06-30T18:30:00.000Z');
  assert.equal(range.end.toISOString(), '2026-07-02T18:30:00.000Z');
});

test('lead label filters generate server-side any, all, and no-label predicates', () => {
  const { buildLabelPredicate } = require('../src/services/lead.service');
  assert.match(buildLabelPredicate({ ids: [1, 2], labelMode: 'any' }), /EXISTS/);
  assert.match(buildLabelPredicate({ ids: [1, 2], labelMode: 'all' }), /= 2$/);
  assert.match(buildLabelPredicate({ hasNoLabels: true }), /^NOT EXISTS/);
});
