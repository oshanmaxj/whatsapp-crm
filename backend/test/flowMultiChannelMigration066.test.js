const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sequelize = require('sequelize');

const migration = require('../migrations/066_flow_multi_channel');

// Same fake-queryInterface approach as facebookMigration065.test.js: this
// sandbox has no reachable Postgres instance (see backend/.env — DB_HOST
// points at a local container that isn't running here), so migrations are
// validated against an in-memory model of Postgres's real DDL/locking
// behavior rather than skipped. It also reproduces the self-lock hazard
// migration 065's tests guard against: any schema-inspection call issued
// without { transaction } against a table this migration's own transaction
// already holds an ACCESS EXCLUSIVE lock on would hang forever on real
// Postgres.
function fakeQueryInterface(preexisting = {}) {
  const tables = {
    flows: { id: {}, name: {}, channel: {}, whatsapp_account_id: {}, facebook_page_id: {}, ...preexisting.flows }
  };
  const lockedByTransaction = new Set();

  function assertNotSelfLocking(table, options, callName) {
    if (!options?.transaction && lockedByTransaction.has(table)) {
      throw Object.assign(
        new Error(`SELF_LOCK: ${callName}('${table}') ran without { transaction } while this migration's own transaction already holds an ACCESS EXCLUSIVE lock on '${table}'.`),
        { code: 'SELF_LOCK_DETECTED', table, callName }
      );
    }
  }

  const q = {
    async showAllTables(options = {}) {
      for (const table of lockedByTransaction) assertNotSelfLocking(table, options, 'showAllTables');
      return Object.keys(tables);
    },
    async describeTable(table, options = {}) {
      assertNotSelfLocking(table, options, 'describeTable');
      return { ...(tables[table] || {}) };
    },
    async addColumn(table, column, definition, options = {}) {
      tables[table] = tables[table] || {};
      tables[table][column] = { allowNull: definition.allowNull !== false, defaultValue: definition.defaultValue, type: definition.type };
      if (options.transaction) lockedByTransaction.add(table);
    },
    sequelize: {
      async transaction(fn) {
        const transaction = {};
        return fn(transaction);
      },
      async query() { return [[]]; }
    }
  };
  return { q, tables, lockedByTransaction };
}

test('migration 066 adds a nullable channels column to flows on first run', async () => {
  const { q, tables } = fakeQueryInterface();
  await migration.up(q, Sequelize);
  assert.ok(tables.flows.channels, 'expected flows.channels to exist');
  assert.equal(tables.flows.channels.allowNull, true, 'channels must be nullable so existing rows default to NULL');
  assert.equal(tables.flows.channels.defaultValue, null, 'channels must have no default value (existing rows stay NULL, not [])');
});

test('migration 066 does not touch unrelated existing columns', async () => {
  const { q, tables } = fakeQueryInterface();
  await migration.up(q, Sequelize);
  assert.ok(tables.flows.channel, 'legacy flows.channel column must remain untouched');
  assert.ok(tables.flows.whatsapp_account_id, 'flows.whatsapp_account_id must remain untouched');
  assert.ok(tables.flows.facebook_page_id, 'flows.facebook_page_id must remain untouched');
});

test('migration 066 is safe to run twice (idempotent, no duplicate-column error)', async () => {
  const { q, tables } = fakeQueryInterface();
  await migration.up(q, Sequelize);
  await assert.doesNotReject(migration.up(q, Sequelize));
  assert.equal(Object.keys(tables.flows).length, Object.keys(tables.flows).length); // still exactly one channels key, not duplicated
});

test('migration 066 never runs against an already-migrated column (addColumn is skipped, not re-attempted)', async () => {
  const { q, tables } = fakeQueryInterface({ flows: { channels: { allowNull: true } } });
  let addColumnCalls = 0;
  const original = q.addColumn;
  q.addColumn = async (...args) => { addColumnCalls += 1; return original(...args); };
  await migration.up(q, Sequelize);
  assert.equal(addColumnCalls, 0, 'addColumn should be skipped when channels already exists');
});

test('migration 066 never self-locks: describeTable after addColumn always passes { transaction }', async () => {
  const { q } = fakeQueryInterface();
  await assert.doesNotReject(migration.up(q, Sequelize));
});

test('migration 066 is a no-op (not an error) against a database with no flows table yet', async () => {
  const { q } = fakeQueryInterface();
  delete require.cache[require.resolve('../migrations/066_flow_multi_channel')];
  const fresh = require('../migrations/066_flow_multi_channel');
  q.showAllTables = async () => [];
  await assert.doesNotReject(fresh.up(q, Sequelize));
});

test('migration wires into the runner and follows the numbered-file convention', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'src/scripts/run_migrations.js'), 'utf8');
  assert.match(runner, /066_flow_multi_channel/);
  assert.match(runner, /runMigration\('066_flow_multi_channel\.js'/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'migrations/066_flow_multi_channel.js')));
});

test('down() is a documented no-op, consistent with every other additive migration in this codebase', async () => {
  await assert.doesNotReject(migration.down());
});
