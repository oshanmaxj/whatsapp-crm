const test = require('node:test');
const assert = require('node:assert/strict');
const migration = require('../migrations/063_campaign_delivery_recovery');
const fs = require('node:fs');
const path = require('node:path');

const base = {
  message_queue: { id: 'bigint', status: 'USER-DEFINED', scheduled_at: 'timestamp with time zone', campaign_id: 'bigint', campaign_recipient_id: 'bigint' },
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
      if (/FROM information_schema\.tables/.test(sql)) return [Object.keys(columns).map(table_name => ({ table_name })), {}];
      if (/FROM information_schema\.columns/.test(sql)) {
        const { table, name } = options.replacements;
        const type = columns[table]?.[name];
        return [type ? [{ data_type: type, character_maximum_length: name === 'worker_id' ? 160 : null, is_nullable: 'YES', column_default: null }] : [], {}];
      }
      if (/GROUP BY campaign_id,campaign_recipient_id/.test(sql)) return [state.duplicates, {}];
      if (/FROM pg_indexes/.test(sql)) {
        const definition = indexes[options.replacements.name];
        return [definition ? [{ indexdef: definition }] : [], {}];
      }
      const alter = sql.match(/^ALTER TABLE "([^"]+)" ADD COLUMN "([^"]+)" (.+)$/);
      if (alter) {
        const type = alter[3].startsWith('TIMESTAMPTZ') ? 'timestamp with time zone'
          : alter[3].startsWith('VARCHAR') ? 'character varying'
            : alter[3].startsWith('JSONB') ? 'jsonb'
              : alter[3].startsWith('INTEGER') ? 'integer' : 'text';
        columns[alter[1]][alter[2]] = type;
        return [[], {}];
      }
      if (/CREATE UNIQUE INDEX message_queue_campaign_recipient_unique/.test(sql)) {
        indexes.message_queue_campaign_recipient_unique = 'CREATE UNIQUE INDEX message_queue_campaign_recipient_unique ON public.message_queue USING btree (campaign_id, campaign_recipient_id) WHERE ((campaign_id IS NOT NULL) AND (campaign_recipient_id IS NOT NULL))';
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

test('migration 063 reports duplicate idempotency keys before DDL and rolls back immediately', async () => {
  const db = database({ duplicates: [{ campaign_id: '8', campaign_recipient_id: '11', job_count: 2 }] });
  await assert.rejects(migration.up(db.q), error => {
    assert.equal(error.code, 'MIGRATION_DUPLICATES_FOUND');
    assert.equal(error.migrationOperation, 'check duplicate campaign delivery jobs');
    return true;
  });
  assert.equal(db.state.commits, 0);
  assert.equal(db.state.rollbacks, 1);
  assert.equal(db.state.operations.some(sql => /^ALTER TABLE/.test(sql)), false);
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
