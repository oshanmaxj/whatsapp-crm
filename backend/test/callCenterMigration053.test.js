const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Sequelize = require('sequelize');
const migration = require('../migrations/053_call_center_supervisor_dashboard');

function environment({ overrideTable = true, failAt = null } = {}) {
  let state = {
    tables: {
      users: new Set(['id', 'is_system_admin', 'deleted_at', 'created_at', 'updated_at']),
      permissions: new Set(['id', 'code', 'name', 'description', 'deleted_at', 'created_at', 'updated_at']),
      roles: new Set(['id', 'name', 'deleted_at']),
      role_permissions: new Set(['role_id', 'permission_id', 'granted_at']),
      call_activities: new Set(['id', 'agent_user_id', 'ended_at']),
      ...(overrideTable ? { user_permission_overrides: new Set(['user_id', 'permission_id', 'effect', 'created_at', 'updated_at']) } : {})
    },
    permissions: new Map(),
    overrides: new Map([['1:legacy', 'deny']]),
    roleGrants: new Set(),
    presence: false,
    indexes: new Set()
  };
  const users = [{ id: 1, admin: true }, { id: 2, admin: false }];
  const roles = [{ id: 10, name: 'Admin' }, { id: 20, name: 'Manager' }, { id: 30, name: 'Agent' }];
  let activeTransaction;
  let operationCount = 0;
  const check = (options) => assert.equal(options?.transaction, activeTransaction, 'operation escaped the migration transaction');
  const q = {
    sequelize: {
      async transaction(callback) {
        const snapshot = structuredClone({
          tables: [...Object.entries(state.tables)].map(([name, columns]) => [name, [...columns]]),
          permissions: [...state.permissions], overrides: [...state.overrides],
          roleGrants: [...state.roleGrants], presence: state.presence, indexes: [...state.indexes]
        });
        activeTransaction = { id: 'migration-053-transaction' };
        try { return await callback(activeTransaction); }
        catch (error) {
          state = {
            tables: Object.fromEntries(snapshot.tables.map(([name, columns]) => [name, new Set(columns)])),
            permissions: new Map(snapshot.permissions), overrides: new Map(snapshot.overrides),
            roleGrants: new Set(snapshot.roleGrants), presence: snapshot.presence, indexes: new Set(snapshot.indexes)
          };
          throw error;
        } finally { activeTransaction = null; }
      },
      async query(sql, options) {
        check(options);
        operationCount += 1;
        if (failAt && operationCount === failAt) throw new Error('injected migration failure');
        if (/information_schema\.columns/.test(sql)) {
          return [[...(state.tables[options.replacements.table] || [])].map((column_name) => ({ column_name }))];
        }
        if (/pg_advisory_xact_lock/.test(sql)) return [[], {}];
        if (/CREATE TABLE IF NOT EXISTS call_center_presence_sessions/.test(sql)) {
          state.presence = true;
          state.tables.call_center_presence_sessions = new Set(['id', 'user_id', 'session_identifier']);
          return [[], {}];
        }
        if (/CREATE (UNIQUE )?INDEX IF NOT EXISTS/.test(sql)) {
          const name = sql.match(/EXISTS\s+(\w+)/i)?.[1];
          if (name) state.indexes.add(name);
          return [[], {}];
        }
        if (/INSERT INTO permissions/.test(sql)) {
          state.permissions.set(options.replacements.code, options.replacements.name);
          return [[], {}];
        }
        if (/INSERT INTO user_permission_overrides/.test(sql)) {
          assert.deepEqual(options.replacements.supervisorPermissionCodes, migration.constants.SUPERVISOR_PERMISSION_CODES);
          for (const user of users.filter((item) => item.admin)) {
            for (const code of options.replacements.supervisorPermissionCodes) state.overrides.set(`${user.id}:${code}`, 'allow');
          }
          return [[], {}];
        }
        if (/INSERT INTO role_permissions/.test(sql)) {
          const codes = options.replacements.supervisorPermissionCodes || ['call_center.agent_workspace'];
          if (options.replacements.supervisorRoleNames) {
            for (const role of roles.filter((item) => options.replacements.supervisorRoleNames.includes(item.name.toLowerCase()))) {
              for (const code of codes) state.roleGrants.add(`${role.id}:${code}`);
            }
          } else if (options.replacements.legacySupervisorCodes) {
            for (const code of codes) state.roleGrants.add(`20:${code}`);
          } else if (options.replacements.legacyAgentCodes) {
            state.roleGrants.add('30:call_center.agent_workspace');
          }
          return [[], {}];
        }
        throw new Error(`Unexpected SQL: ${sql}`);
      }
    },
    async createTable(name, columns, options) {
      check(options);
      state.tables[name] = new Set(Object.keys(columns));
    }
  };
  return { q, get state() { return state; } };
}

test('migration 053 completes and reruns idempotently with one transaction per run', async () => {
  const env = environment();
  await migration.up(env.q, Sequelize);
  await migration.up(env.q, Sequelize);
  assert.equal(env.state.permissions.size, 6);
  assert.equal(env.state.overrides.size, 6);
  assert.equal(env.state.roleGrants.size, 11);
  assert.equal(env.state.presence, true);
  assert.equal(env.state.indexes.size, 2);
});

test('migration 053 creates a missing override table and updates existing admin overrides', async () => {
  const env = environment({ overrideTable: false });
  await migration.up(env.q, Sequelize);
  assert.ok(env.state.tables.user_permission_overrides.has('effect'));
  assert.equal(env.state.overrides.get('1:call_center.supervisor_dashboard'), 'allow');
  assert.equal([...env.state.overrides].filter(([key]) => key === '1:call_center.supervisor_dashboard').length, 1);
});

test('agents receive workspace but never supervisor permissions', async () => {
  const env = environment();
  await migration.up(env.q, Sequelize);
  assert.ok(env.state.roleGrants.has('30:call_center.agent_workspace'));
  assert.equal([...env.state.roleGrants].some((grant) => grant.startsWith('30:call_center.supervisor_') || grant.startsWith('30:call_center.view_')), false);
  for (const code of migration.constants.SUPERVISOR_PERMISSION_CODES) {
    assert.ok(env.state.roleGrants.has(`10:${code}`));
    assert.ok(env.state.roleGrants.has(`20:${code}`));
  }
});

test('migration 053 rollback leaves no partial changes', async () => {
  const env = environment({ overrideTable: false, failAt: 8 });
  await assert.rejects(migration.up(env.q, Sequelize), /injected migration failure/);
  assert.equal(env.state.permissions.size, 0);
  assert.equal(env.state.presence, false);
  assert.equal(env.state.tables.user_permission_overrides, undefined);
});

test('migration 053 uses parameterized PostgreSQL lists and contains no invalid ANY CAST list', () => {
  const source = fs.readFileSync(path.join(__dirname, '../migrations/053_call_center_supervisor_dashboard.js'), 'utf8');
  assert.match(source, /p\.code IN \(:supervisorPermissionCodes\)/);
  assert.doesNotMatch(source, /ANY\s*\(\s*CAST\s*\(/i);
  assert.doesNotMatch(source, /CAST\s*\(\s*'[^']+'\s*,/i);
  assert.doesNotMatch(source, /Model\.sync|\.sync\(/);
  assert.match(source, /queryInterface\.createTable[\s\S]*\{ transaction \}/);
});
