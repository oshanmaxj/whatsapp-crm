const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sequelize = require('sequelize');

const migration = require('../migrations/065_facebook_page_integration');

// In-memory fake queryInterface: exercises the real migration's up() logic
// (idempotency guards, table/column/index creation) without a live database,
// since this sandbox has no reachable Postgres instance. Models the exact
// operations migration 065 performs (describeTable/createTable/addColumn/
// showIndex/addIndex/changeColumn/showAllTables + raw sequelize.query for the
// advisory lock, SET LOCAL, and permission upserts).
//
// It also models enough of Postgres's real locking behavior to catch the
// production incident this migration once caused: DDL run with
// { transaction } (createTable/addColumn/changeColumn/addIndex) marks that
// table as ACCESS-EXCLUSIVE-locked by the open transaction. Any later
// schema-inspection call (describeTable/showIndex/showAllTables) against a
// locked table that is issued WITHOUT { transaction } would, on a real
// Postgres server, run on a *different* pooled connection and queue forever
// behind that lock while the migration's own transaction sits "idle in
// transaction" waiting on the very promise that can never resolve — exactly
// what happened in production. This fake throws SELF_LOCK_DETECTED instead
// of hanging, so the bug fails a test rather than freezing a real database.
function fakeQueryInterface(preexisting = {}) {
  const tables = {
    users: { id: {}, email: {}, ...preexisting.users },
    contacts: { id: {}, phone: { allowNull: false }, ...preexisting.contacts },
    conversations: { id: {}, ...preexisting.conversations },
    messages: { id: {}, channel: {}, ...preexisting.messages },
    leads: { id: {}, ...preexisting.leads },
    flows: { id: {}, ...preexisting.flows },
    flow_runs: { id: {}, ...preexisting.flow_runs },
    permissions: { id: {} },
    roles: { id: {} },
    role_permissions: { id: {} }
  };
  const indexes = {};
  const queries = [];
  const lockedByTransaction = new Set();

  function assertNotSelfLocking(table, options, callName) {
    if (!options?.transaction && lockedByTransaction.has(table)) {
      throw Object.assign(
        new Error(`SELF_LOCK: ${callName}('${table}') ran without { transaction } while this migration's own transaction already holds an ACCESS EXCLUSIVE lock on '${table}'. On real Postgres this hangs forever ("idle in transaction").`),
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
    async createTable(table, definition, options = {}) {
      tables[table] = Object.fromEntries(Object.keys(definition).map((key) => [key, { allowNull: definition[key].allowNull !== false }]));
      if (options.transaction) lockedByTransaction.add(table);
    },
    async addColumn(table, column, definition, options = {}) {
      tables[table] = tables[table] || {};
      tables[table][column] = { allowNull: definition.allowNull !== false, defaultValue: definition.defaultValue };
      if (options.transaction) lockedByTransaction.add(table);
    },
    async changeColumn(table, column, definition, options = {}) {
      tables[table][column] = { ...tables[table][column], allowNull: definition.allowNull !== false };
      if (options.transaction) lockedByTransaction.add(table);
    },
    async showIndex(table, options = {}) {
      assertNotSelfLocking(table, options, 'showIndex');
      return indexes[table] || [];
    },
    async addIndex(table, fields, options = {}) {
      indexes[table] = indexes[table] || [];
      indexes[table].push({ name: options.name, fields, unique: Boolean(options.unique) });
      if (options.transaction) lockedByTransaction.add(table);
    },
    sequelize: {
      async transaction(fn) { return fn({}); },
      async query(sql, options = {}) { queries.push(String(sql)); return [[]]; }
    }
  };
  return { q, tables, indexes, queries, lockedByTransaction };
}

test('migration 065 creates every new Facebook table on first run', async () => {
  const { q, tables } = fakeQueryInterface();
  await migration.up(q, Sequelize);
  for (const table of ['facebook_pages', 'facebook_contacts', 'facebook_comments', 'facebook_webhook_events', 'user_facebook_pages']) {
    assert.ok(tables[table], `expected ${table} to be created`);
  }
});

test('migration 065 adds additive columns without touching unrelated columns', async () => {
  const { q, tables } = fakeQueryInterface();
  await migration.up(q, Sequelize);
  assert.ok(tables.users.all_facebook_pages, 'users.all_facebook_pages should exist');
  assert.ok(tables.conversations.channel, 'conversations.channel should exist');
  assert.ok(tables.conversations.facebook_page_id, 'conversations.facebook_page_id should exist');
  assert.ok(tables.conversations.facebook_thread_key, 'conversations.facebook_thread_key should exist');
  assert.ok(tables.messages.facebook_message_id, 'messages.facebook_message_id should exist');
  assert.ok(tables.leads.facebook_page_id, 'leads.facebook_page_id should exist');
  assert.ok(tables.flows.channel, 'flows.channel should exist');
  assert.ok(tables.flow_runs.last_facebook_message_id, 'flow_runs.last_facebook_message_id should exist');
  assert.equal(tables.contacts.phone.allowNull, true, 'contacts.phone must become nullable');
});

test('migration 065 is safe to run twice (idempotent, no duplicate tables/columns/indexes)', async () => {
  const { q, tables, indexes } = fakeQueryInterface();
  await migration.up(q, Sequelize);
  const afterFirstRunTableCount = Object.keys(tables).length;
  const afterFirstRunIndexCounts = Object.fromEntries(Object.entries(indexes).map(([table, list]) => [table, list.length]));

  await migration.up(q, Sequelize); // rerun against the now-migrated fake schema

  assert.equal(Object.keys(tables).length, afterFirstRunTableCount, 'rerun must not create duplicate tables');
  for (const [table, list] of Object.entries(indexes)) {
    assert.equal(list.length, afterFirstRunIndexCounts[table], `rerun must not duplicate indexes on ${table}`);
  }
  // Every index name actually used by the migration must remain unique after two runs.
  for (const list of Object.values(indexes)) {
    const names = list.map((entry) => entry.name);
    assert.equal(new Set(names).size, names.length, 'index names must stay unique after rerun');
  }
});

test('migration 065 never runs against an already-nullable phone column', async () => {
  const { q, tables } = fakeQueryInterface({ contacts: { phone: { allowNull: true } } });
  let changeColumnCalls = 0;
  const originalChangeColumn = q.changeColumn;
  q.changeColumn = async (...args) => { changeColumnCalls += 1; return originalChangeColumn(...args); };
  await migration.up(q, Sequelize);
  assert.equal(changeColumnCalls, 0, 'changeColumn should be skipped when phone is already nullable');
});

test('migration wires into the runner and follows the numbered-file convention', () => {
  const runner = fs.readFileSync(path.join(__dirname, '..', 'src/scripts/run_migrations.js'), 'utf8');
  assert.match(runner, /065_facebook_page_integration/);
  assert.match(runner, /runMigration\('065_facebook_page_integration\.js'/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'migrations/065_facebook_page_integration.js')));
});

test('migration 065 never self-locks: no schema-inspection call runs unguarded against a table its own transaction already holds an ACCESS EXCLUSIVE lock on', async () => {
  // Reproduces the exact production incident: conversations.channel is added
  // first, then facebook_page_id and facebook_thread_key are added to the
  // same table, then two indexes are added to it. Each of those later steps
  // starts with a schema-inspection call (describeTable/showIndex) against
  // 'conversations' — a table already locked earlier in this same run. If any
  // of those calls forgot { transaction }, this run would reject with
  // SELF_LOCK_DETECTED instead of a live database hanging indefinitely.
  const { q } = fakeQueryInterface();
  await assert.doesNotReject(migration.up(q, Sequelize));
});

test('the self-lock detector actually catches the historical bug (sanity check on the test harness itself)', async () => {
  const { q } = fakeQueryInterface();
  // Simulate the exact failure: an earlier ALTER (correctly scoped to the
  // transaction) followed by an unguarded inspection call on the same table.
  await q.createTable('conversations', { id: {} }, { transaction: {} });
  await assert.rejects(
    q.describeTable('conversations', {}),
    (error) => error.code === 'SELF_LOCK_DETECTED' && error.table === 'conversations'
  );
  await assert.rejects(
    q.showIndex('conversations', {}),
    (error) => error.code === 'SELF_LOCK_DETECTED'
  );
  // The same calls succeed once they correctly pass the transaction through.
  await assert.doesNotReject(q.describeTable('conversations', { transaction: {} }));
  await assert.doesNotReject(q.showIndex('conversations', { transaction: {} }));
});

test('migration 065 rerun also never self-locks (idempotent path re-inspects every table without deadlocking)', async () => {
  const { q } = fakeQueryInterface();
  await migration.up(q, Sequelize);
  await assert.doesNotReject(migration.up(q, Sequelize));
});

test('migration seeds Facebook permission codes and grants them to admin roles', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'migrations/065_facebook_page_integration.js'), 'utf8');
  for (const code of ['facebook-pages.view', 'facebook-pages.edit', 'facebook-messenger.view', 'facebook-messenger.send', 'facebook-comments.view', 'facebook-comments.reply']) {
    assert.ok(source.includes(code), `expected permission seed for ${code}`);
  }
  assert.match(source, /ON CONFLICT \(code\) DO UPDATE/);
  assert.match(source, /role_permissions/);
});
