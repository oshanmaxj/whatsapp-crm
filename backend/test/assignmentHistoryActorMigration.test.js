const test = require('node:test');
const assert = require('node:assert/strict');
const Sequelize = require('sequelize');
const migration = require('../migrations/050_assignment_history_actor');

test('migration 050 is locked, bounded, and idempotent', async () => {
  const columns = { changed_by_user_id: { allowNull: false } };
  const queries = [];
  let commits = 0;
  let rollbacks = 0;
  const transaction = {
    async commit() { commits += 1; },
    async rollback() { rollbacks += 1; }
  };
  const queryInterface = {
    sequelize: {
      async transaction() { return transaction; },
      getDialect() { return 'postgres'; },
      async query(sql) { queries.push(sql); }
    },
    async describeTable() { return { ...columns }; },
    async addColumn(table, name, definition) { columns[name] = { ...definition }; },
    async changeColumn(table, name, definition) { columns[name] = { ...columns[name], ...definition }; }
  };

  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);

  assert.equal(columns.changed_by_user_id.allowNull, true);
  assert.ok(columns.actor_type);
  assert.ok(columns.source);
  assert.equal(commits, 2);
  assert.equal(rollbacks, 0);
  assert.equal(queries.filter((sql) => sql.includes('pg_advisory_xact_lock')).length, 2);
  assert.equal(queries.filter((sql) => sql.includes('lock_timeout')).length, 2);
  assert.equal(queries.filter((sql) => sql.includes('statement_timeout')).length, 2);
});
