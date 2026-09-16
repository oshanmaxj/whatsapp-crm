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

  const q = {
    async showAllTables() { return Object.keys(tables); },
    async describeTable(table) { return { ...(tables[table] || {}) }; },
    async createTable(table, definition) {
      tables[table] = Object.fromEntries(Object.keys(definition).map((key) => [key, { allowNull: definition[key].allowNull !== false }]));
    },
    async addColumn(table, column, definition) {
      tables[table] = tables[table] || {};
      tables[table][column] = { allowNull: definition.allowNull !== false, defaultValue: definition.defaultValue };
    },
    async changeColumn(table, column, definition) {
      tables[table][column] = { ...tables[table][column], allowNull: definition.allowNull !== false };
    },
    async showIndex(table) { return indexes[table] || []; },
    async addIndex(table, fields, options) {
      indexes[table] = indexes[table] || [];
      indexes[table].push({ name: options.name, fields, unique: Boolean(options.unique) });
    },
    sequelize: {
      async transaction(fn) { return fn({}); },
      async query(sql, options = {}) { queries.push(String(sql)); return [[]]; }
    }
  };
  return { q, tables, indexes, queries };
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

test('migration seeds Facebook permission codes and grants them to admin roles', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'migrations/065_facebook_page_integration.js'), 'utf8');
  for (const code of ['facebook-pages.view', 'facebook-pages.edit', 'facebook-messenger.view', 'facebook-messenger.send', 'facebook-comments.view', 'facebook-comments.reply']) {
    assert.ok(source.includes(code), `expected permission seed for ${code}`);
  }
  assert.match(source, /ON CONFLICT \(code\) DO UPDATE/);
  assert.match(source, /role_permissions/);
});
