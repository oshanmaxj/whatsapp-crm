const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveDatabaseConfig } = require('../src/config/databaseConfig');

test('explicit PostgreSQL dialect defaults to port 5432', () => {
  assert.equal(resolveDatabaseConfig({ DB_DIALECT: 'postgres' }).port, 5432);
});

test('PostgreSQL DATABASE_URL resolves dialect and default port', () => {
  const value = resolveDatabaseConfig({ DATABASE_URL: 'postgresql://user:secret@localhost/app' });
  assert.deepEqual({ dialect: value.dialect, port: value.port }, { dialect: 'postgres', port: 5432 });
});

test('explicit DB_PORT overrides the dialect and URL defaults', () => {
  assert.equal(resolveDatabaseConfig({ DATABASE_URL: 'postgres://user:secret@localhost:5433/app', DB_PORT: '5544' }).port, 5544);
});

test('MySQL defaults to port 3306', () => {
  assert.deepEqual(resolveDatabaseConfig({ DB_DIALECT: 'mysql' }).port, 3306);
});

test('invalid DB_PORT fails fast', () => {
  assert.throws(() => resolveDatabaseConfig({ DB_DIALECT: 'postgres', DB_PORT: '70000' }), /integer between 1 and 65535/);
});

test('conflicting dialect sources fail fast without exposing credentials', () => {
  assert.throws(
    () => resolveDatabaseConfig({ DB_DIALECT: 'mysql', DATABASE_URL: 'postgres://user:secret@localhost/app' }),
    (error) => /configuration conflict/.test(error.message) && !error.message.includes('secret')
  );
});
