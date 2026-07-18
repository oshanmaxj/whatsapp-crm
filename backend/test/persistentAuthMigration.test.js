const test = require('node:test');
const assert = require('node:assert/strict');
const Sequelize = require('sequelize');
const migration = require('../migrations/035_add_persistent_auth_sessions');

test('persistent auth session migration is additive and idempotent', async () => {
  const tables = { users: { id: {} } };
  const indexes = [];
  const qi = {
    async describeTable(name) { if (!tables[name]) throw new Error('missing'); return tables[name]; },
    async createTable(name, columns) { tables[name] = columns; },
    async addIndex(table, fields, options) { indexes.push({ table, fields, name: options.name }); }
  };
  await migration.up(qi, Sequelize);
  await migration.up(qi, Sequelize);
  assert.ok(tables.auth_sessions.token_hash);
  assert.equal(indexes.filter((item) => item.name === 'auth_sessions_user_active_idx').length, 1);
});
