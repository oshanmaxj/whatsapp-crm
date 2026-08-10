const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../migrations/063_campaign_delivery_recovery');
const fs = require('node:fs');
const path = require('node:path');

const base = {
  message_queue: { id: 'bigint', status: 'USER-DEFINED', scheduled_at: 'timestamp with time zone', processed_at: 'timestamp with time zone', attempts: 'integer', last_error: 'text', created_at: 'timestamp with time zone', updated_at: 'timestamp with time zone' },
  campaign_recipients: { id: 'bigint', campaign_id: 'bigint', status: 'USER-DEFINED', external_message_id: 'character varying' },
  campaigns: { id: 'bigint', status: 'USER-DEFINED' }
};

function database(seed = {}) {
  const columns = Object.fromEntries(Object.entries(base).map(([table, values]) => [table, { ...values }]));
  for (const [table, values] of Object.entries(seed.columns || {})) Object.assign(columns[table], values);
  const indexes = { ...(seed.indexes || {}) };
  const state = { columns, indexes, duplicates: seed.duplicates || [], commits: 0, rollbacks: 0, operations: [] };
  const transaction = { finished: null, async commit() { this.finished = 'commit'; state.commits += 1; }, async rollback() { this.finished = 'rollback'; state.rollbacks += 1; } };
  const sequelize = {
    async transaction() { return { ...transaction, finished: null }; },
    async query(sql, options = {}) {
      state.operations.push(sql.replace(/\s+/g, ' ').trim());
      if (/^SET LOCAL|pg_advisory_xact_lock/.test(sql)) return [[], {}];
      if (/to_regclass\('message_queue'\)/.test(sql)) {
        assert.equal(options.type, require('sequelize').QueryTypes.SELECT);
        return [{
          message_queue: seed.missingTables?.includes('message_queue') ? null : 'message_queue',
          campaign_recipients: seed.missingTables?.includes('campaign_recipients') ? null : 'campaign_recipients',
          campaigns: seed.missingTables?.includes('campaigns') ? null : 'campaigns'
        }];
      }
      if (/FROM information_schema\.columns/.test(sql)) {
        const { table, name } = options.replacements;
        const type = columns[table]?.[name];
        return [type ? [{ data_type: type, character_maximum_length: name === 'worker_id' ? 160 : null, is_nullable: 'YES', column_default: null }] : [], {}];
      }
      if (/JOIN \(SELECT campaign_id,campaign_recipient_id FROM message_queue/.test(sql)) return [state.duplicates, {}];
      if (/^UPDATE message_queue SET status='cancelled'/.test(sql.trim())) {
        state.superseded = [...(state.superseded || []), ...options.replacements.ids];
        return [[], {}];
      }
      if (/FROM pg_indexes/.test(sql)) {
        const definition = indexes[options.replacements.name];
        return [definition ? [{ indexdef: definition }] : [], {}];
      }
      const alter = sql.match(/^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)" (.+)$/);
      if (alter) {
        const type = alter[3].startsWith('TIMESTAMPTZ') ? 'timestamp with time zone'
          : alter[3].startsWith('VARCHAR') ? 'character varying'
            : alter[3].startsWith('JSONB') ? 'jsonb'
              : alter[3].startsWith('INTEGER') ? 'integer'
                : alter[3].startsWith('BIGINT') ? 'bigint' : 'text';
        columns[alter[1]][alter[2]] = type;
        return [[], {}];
      }
      if (/CREATE UNIQUE INDEX message_queue_campaign_recipient_unique/.test(sql)) {
        indexes.message_queue_campaign_recipient_unique = "CREATE UNIQUE INDEX message_queue_campaign_recipient_unique ON public.message_queue USING btree (campaign_id, campaign_recipient_id) WHERE ((campaign_id IS NOT NULL) AND (campaign_recipient_id IS NOT NULL) AND (status <> 'cancelled'))";
        return [[], {}];
      }
      if (/CREATE INDEX message_queue_claimable_idx/.test(sql)) {
        indexes.message_queue_claimable_idx = 'CREATE INDEX message_queue_claimable_idx ON public.message_queue USING btree (status, scheduled_at, locked_at)';
        return [[], {}];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  return { q: { sequelize }, state };
}

test('migration 063 creates a clean schema and is safe on a second consecutive run', async () => {
  const db = database();
  await migration.up(db.q);
  await migration.up(db.q);
  assert.equal(db.state.commits, 2);
  assert.equal(db.state.rollbacks, 0);
  assert.equal(db.state.columns.message_queue.claimed_at, 'timestamp with time zone');
  assert.match(db.state.indexes.message_queue_campaign_recipient_unique, /UNIQUE INDEX/);
});

test('required table detection parses QueryTypes.SELECT to_regclass rows in public search path', async () => {
  const calls = [];
  const q = { sequelize: { query: async (sql, options) => {
    calls.push({ sql, options });
    return [{ message_queue: 'message_queue', campaign_recipients: 'campaign_recipients', campaigns: 'campaigns' }];
  } } };
  const names = await migration._test.tableNames(q, {});
  assert.deepEqual([...names], ['message_queue', 'campaign_recipients', 'campaigns']);
  assert.equal(calls[0].options.type, require('sequelize').QueryTypes.SELECT);
  assert.match(calls[0].sql, /to_regclass\('message_queue'\)/);
  assert.doesNotMatch(calls[0].sql, /information_schema\.tables|current_schema/);
});

test('required table detection reports only a genuinely missing relation', async () => {
  const db = database({ missingTables: ['campaign_recipients'] });
  await assert.rejects(migration.up(db.q), error => {
    assert.equal(error.code, 'MIGRATION_SCHEMA_MISMATCH');
    assert.match(error.message, /campaign_recipients/);
    assert.doesNotMatch(error.message, /message_queue,|campaigns/);
    return true;
  });
  assert.equal(db.state.rollbacks, 1);
});

test('required relation lookup is compatible with current_schema public and search_path "$user", public', () => {
  const source = fs.readFileSync(path.join(__dirname, '../migrations/063_campaign_delivery_recovery.js'), 'utf8');
  assert.match(source, /to_regclass\('message_queue'\)/);
  assert.match(source, /QueryTypes\.SELECT/);
  assert.doesNotMatch(source, /table_schema=current_schema\(\).*table_name IN/s);
});

test('migration 063 completes from a partially migrated compatible schema without overwriting data', async () => {
  const db = database({ columns: {
    message_queue: { claimed_at: 'timestamp with time zone', locked_at: 'timestamp with time zone', worker_id: 'character varying' },
    campaigns: { started_at: 'timestamp with time zone', total_recipients: 'integer' }
  } });
  await migration.up(db.q);
  assert.equal(db.state.commits, 1);
  assert.ok(db.state.columns.campaign_recipients.error_details);
  assert.equal(db.state.operations.some(sql => /ADD COLUMN "claimed_at"/.test(sql)), false);
});

test('migration 063 reconciles duplicate unsent jobs without deleting history', async () => {
  const db = database({ duplicates: [
    { id: '20', campaign_id: '8', campaign_recipient_id: '11', status: 'queued', external_message_id: null },
    { id: '21', campaign_id: '8', campaign_recipient_id: '11', status: 'queued', external_message_id: null }
  ] });
  await migration.up(db.q);
  assert.deepEqual(db.state.superseded, ['21']);
  assert.equal(db.state.commits, 1);
});

test('migration 063 preserves sent evidence and supersedes an unsent duplicate', async () => {
  const db = database({ duplicates: [
    { id: '30', campaign_id: '9', campaign_recipient_id: '12', status: 'sent', external_message_id: 'wamid.one' },
    { id: '31', campaign_id: '9', campaign_recipient_id: '12', status: 'queued', external_message_id: null }
  ] });
  await migration.up(db.q);
  assert.deepEqual(db.state.superseded, ['31']);
});

test('migration 063 rolls back conflicting submitted duplicates for manual review', async () => {
  const db = database({ duplicates: [
    { id: '40', campaign_id: '10', campaign_recipient_id: '13', status: 'sent', external_message_id: 'wamid.one' },
    { id: '41', campaign_id: '10', campaign_recipient_id: '13', status: 'sent', external_message_id: 'wamid.two' }
  ] });
  await assert.rejects(migration.up(db.q), error => error.code === 'MIGRATION_DUPLICATES_AMBIGUOUS');
  assert.equal(db.state.rollbacks, 1);
  assert.equal(db.state.superseded, undefined);
});

test('migration 063 cancels all queued duplicates when the recipient already has send evidence', async () => {
  const db = database({ duplicates: [
    { id: '50', campaign_id: '11', campaign_recipient_id: '14', status: 'queued', external_message_id: null, recipient_status: 'sent', recipient_external_message_id: 'wamid.recipient' },
    { id: '51', campaign_id: '11', campaign_recipient_id: '14', status: 'retrying', external_message_id: null, recipient_status: 'sent', recipient_external_message_id: 'wamid.recipient' }
  ] });
  await migration.up(db.q);
  assert.deepEqual(db.state.superseded, ['50', '51']);
});

test('migration 063 rejects incompatible partial columns rather than altering production data', async () => {
  const db = database({ columns: { message_queue: { claimed_at: 'timestamp without time zone' } } });
  await assert.rejects(migration.up(db.q), error => {
    assert.equal(error.code, 'MIGRATION_SCHEMA_MISMATCH');
    assert.equal(error.migrationOperation, 'ensure column message_queue.claimed_at');
    return true;
  });
  assert.equal(db.state.rollbacks, 1);
});

test('project migration runner uses one fail-fast advisory lock and does not suppress DDL errors', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/scripts/run_migrations.js'), 'utf8');
  assert.match(source, /pg_try_advisory_xact_lock/);
  assert.match(source, /MIGRATION_RUNNER_ACTIVE/);
  assert.doesNotMatch(source, /Failed to add .*console\.error/);
  assert.match(source, /error\.migrationOperation = `add column/);
  assert.match(source, /error\.migrationOperation = `add index/);
});
