const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const aiMigration = require('../migrations/045_whatsapp_ai_agents');
const pipelineMigration = require('../migrations/027_lead_pipeline_followups');

test('AI migration accepts all four existing compatible indexes without CREATE INDEX', async () => {
  const definitions = {
    ai_agents_status_idx: 'CREATE INDEX ai_agents_status_idx ON public.ai_agents USING btree (status)',
    ai_state_agent_status_idx: 'CREATE INDEX ai_state_agent_status_idx ON public.ai_conversation_states USING btree (ai_agent_id, status)',
    ai_knowledge_valid_idx: 'CREATE INDEX ai_knowledge_valid_idx ON public.ai_knowledge_sources USING btree (ai_agent_id, status, valid_from, valid_until)',
    ai_decisions_conversation_idx: 'CREATE INDEX ai_decisions_conversation_idx ON public.ai_decision_logs USING btree (conversation_id, created_at)'
  };
  const creates = [];
  const q = { sequelize: { query: async (sql, options) => {
    if (/FROM pg_indexes/.test(sql)) return [[{ indexdef: definitions[options.replacements.name] }], {}];
    if (/CREATE INDEX/.test(sql)) creates.push(sql);
    return [[], {}];
  } } };
  const specs = [
    ['ai_agents',['status'],'ai_agents_status_idx'],
    ['ai_conversation_states',['ai_agent_id','status'],'ai_state_agent_status_idx'],
    ['ai_knowledge_sources',['ai_agent_id','status','valid_from','valid_until'],'ai_knowledge_valid_idx'],
    ['ai_decision_logs',['conversation_id','created_at'],'ai_decisions_conversation_idx']
  ];
  for (const [table, columns, name] of specs) await aiMigration._test.ensureIndex(q, { table, columns, name }, {});
  assert.deepEqual(creates, []);
});

test('AI migration rejects a same-name incompatible index before DDL', async () => {
  const q = { sequelize: { query: async sql => /FROM pg_indexes/.test(sql)
    ? [[{ indexdef: 'CREATE INDEX ai_agents_status_idx ON public.ai_agents USING btree (name)' }], {}]
    : [[], {}] } };
  await assert.rejects(aiMigration._test.ensureIndex(q, { table: 'ai_agents', columns: ['status'], name: 'ai_agents_status_idx' }, {}), error => error.code === 'MIGRATION_INDEX_MISMATCH');
});

test('lost reason seed is conflict-safe and preserves existing rows', () => {
  const source = fs.readFileSync(path.join(__dirname, '../migrations/027_lead_pipeline_followups.js'), 'utf8');
  assert.match(source, /ON CONFLICT DO NOTHING/);
  assert.doesNotMatch(source, /bulkInsert\('lost_reasons'.*catch/);
  assert.doesNotMatch(source, /createTable\('lost_reasons'.*catch/);
  assert.doesNotMatch(source, /DELETE FROM lost_reasons|TRUNCATE lost_reasons/i);
});

test('involved migrations contain no catch-and-continue PostgreSQL writes', () => {
  for (const filename of ['027_lead_pipeline_followups.js', '045_whatsapp_ai_agents.js', '063_campaign_delivery_recovery.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../migrations', filename), 'utf8');
    assert.doesNotMatch(source, /\.catch\(\(\)\s*=>\s*(?:null|\{\})\)/, filename);
  }
});
