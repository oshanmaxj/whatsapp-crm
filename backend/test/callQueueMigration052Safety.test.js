const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  allowedNextStatusParameter,
  allowedNextStatusSql
} = require('../migrations/helpers/call_center_schema');
const statusMigration = require('../migrations/049_call_center_statuses');
const queueMigration = require('../migrations/052_call_queue_phase1');

test('allowed_next_status_ids uses explicit JSON casts for empty and non-empty values', () => {
  const type = { kind: 'json', sqlType: 'jsonb' };
  assert.equal(allowedNextStatusParameter([], type), '[]');
  assert.equal(allowedNextStatusParameter([4, 9], type), '[4,9]');
  assert.equal(allowedNextStatusSql(type), 'CAST(:allowedNextStatusIds AS jsonb)');
});

test('allowed_next_status_ids uses the inspected PostgreSQL array element type', () => {
  const integer = { kind: 'array', sqlType: 'integer[]' };
  const bigint = { kind: 'array', sqlType: 'bigint[]' };
  assert.equal(allowedNextStatusParameter([], integer), '{}');
  assert.equal(allowedNextStatusParameter([1, 2], integer), '{1,2}');
  assert.equal(allowedNextStatusParameter([9007199254740991], bigint), '{9007199254740991}');
  assert.equal(allowedNextStatusSql(bigint), 'CAST(:allowedNextStatusIds AS bigint[])');
  assert.throws(() => allowedNextStatusParameter(['not-an-id'], integer), /non-integer/);
});

test('migration 049 stops at the first failed status insert and preserves its operation', async () => {
  const original = Object.assign(new Error('cannot determine type of empty array'), { code: '42P18' });
  let inserts = 0;
  const sequelize = {
    getDialect: () => 'postgres',
    transaction: callback => callback({ id: 'transaction' }),
    async query(sql) {
      if (/information_schema\.columns/.test(sql)) return [[{ data_type: 'jsonb', udt_name: 'jsonb' }]];
      if (/pg_advisory_xact_lock/.test(sql)) return [[], {}];
      if (/INSERT INTO lead_status/.test(sql)) {
        inserts += 1;
        throw original;
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  await assert.rejects(statusMigration.up({ sequelize }), error => {
    assert.equal(error, original);
    assert.equal(error.migrationOperation, 'seed lead status assigned');
    return true;
  });
  assert.equal(inserts, 1);
});

test('role mapping is stable by name and never by a hardcoded ID', () => {
  const roles = queueMigration.resolveRoles([
    { id: 91, name: 'Admin' },
    { id: 17, name: 'Agent' },
    { id: 44, name: 'Manager' }
  ]);
  assert.deepEqual(roles, {
    agent: { id: 17, name: 'Agent' },
    supervisor: { id: 44, name: 'Manager' },
    admin: { id: 91, name: 'Admin' }
  });
  assert.throws(() => queueMigration.resolveRoles([
    { id: 1, name: 'Agent' },
    { id: 2, name: 'Admin' }
  ]), /required Supervisor role is absent/);
});

test('migration 052 inspects role_permissions and conditionally uses its real timestamp', () => {
  const source = fs.readFileSync(path.join(__dirname, '../migrations/052_call_queue_phase1.js'), 'utf8');
  assert.match(source, /describeIfPresent\(queryInterface, 'role_permissions', transaction\)/);
  assert.match(source, /describeTable\('permissions', \{ transaction \}\)/);
  assert.match(source, /includes\('granted_at'\)/);
  assert.match(source, /includes\('created_at'\)/);
  assert.doesNotMatch(source, /role_id\s*=\s*2/);
  assert.doesNotMatch(source, /role_permissions\s*\(role_id,permission_id,created_at,updated_at\)/);
  assert.match(source, /ON CONFLICT DO NOTHING/);
});

test('048 through 052 contain no catch-and-continue migration writes', () => {
  for (const number of ['048', '049', '051', '052']) {
    const filename = fs.readdirSync(path.join(__dirname, '../migrations')).find(name => name.startsWith(number));
    const source = fs.readFileSync(path.join(__dirname, '../migrations', filename), 'utf8');
    assert.doesNotMatch(source, /\.catch\(\(\)=>\{\}\)/, `${filename} must not swallow PostgreSQL errors`);
  }
});
