'use strict';

const LOCK = 530053;
const PERMISSIONS = [
  ['call_center.agent_workspace', 'Use Call Center agent workspace'],
  ['call_center.supervisor_dashboard', 'View Call Center supervisor dashboard'],
  ['call_center.view_all_agents', 'View all Call Center agents'],
  ['call_center.view_live_calls', 'View live Call Center calls'],
  ['call_center.view_all_history', 'View all Call Center history'],
  ['call_center.view_performance', 'View Call Center performance']
];
const SUPERVISOR_PERMISSION_CODES = PERMISSIONS.slice(1).map(([code]) => code);
const AGENT_LEGACY_PERMISSION_CODES = ['call_queue.view_own', 'calls.create', 'calls.view.own'];
const SUPERVISOR_LEGACY_PERMISSION_CODES = ['callcenter.team.view', 'calls.view.team', 'presence.view.team'];
const SUPERVISOR_ROLE_NAMES = ['admin', 'administrator', 'manager', 'supervisor'];

async function operation(name, callback) {
  console.log(`[053_call_center_supervisor_dashboard] ${name}`);
  try {
    return await callback();
  } catch (error) {
    error.migrationOperation = name;
    throw error;
  }
}

function query(queryInterface, sql, transaction, replacements = {}) {
  return queryInterface.sequelize.query(sql, { replacements, transaction });
}

async function tableColumns(queryInterface, table, transaction) {
  const [rows] = await operation(`inspect ${table}`, () => query(
    queryInterface,
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = :table`,
    transaction,
    { table }
  ));
  return new Set(rows.map((row) => row.column_name));
}

async function requireColumns(queryInterface, table, required, transaction) {
  const columns = await tableColumns(queryInterface, table, transaction);
  if (!columns.size) throw new Error(`Preflight failed: ${table} table is missing.`);
  for (const column of required) {
    if (!columns.has(column)) throw new Error(`Preflight failed: ${table}.${column} is missing.`);
  }
  return columns;
}

async function ensureOverrideTable(queryInterface, Sequelize, transaction) {
  let columns = await tableColumns(queryInterface, 'user_permission_overrides', transaction);
  if (!columns.size) {
    await operation('create user_permission_overrides', () => queryInterface.createTable(
      'user_permission_overrides',
      {
        user_id: { type: Sequelize.BIGINT, allowNull: false, primaryKey: true, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
        permission_id: { type: Sequelize.INTEGER, allowNull: false, primaryKey: true, references: { model: 'permissions', key: 'id' }, onDelete: 'CASCADE' },
        effect: { type: Sequelize.STRING(10), allowNull: false },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('NOW()') }
      },
      { transaction }
    ));
    columns = await tableColumns(queryInterface, 'user_permission_overrides', transaction);
  }
  for (const column of ['user_id', 'permission_id', 'effect']) {
    if (!columns.has(column)) throw new Error(`Preflight failed: user_permission_overrides.${column} is missing.`);
  }
  return columns;
}

function timestampInsert(columns, preferred) {
  const timestamp = preferred.find((column) => columns.has(column));
  return timestamp ? { columns: `,${timestamp}`, values: ',NOW()' } : { columns: '', values: '' };
}

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await operation('acquire advisory migration lock', () =>
        query(queryInterface, 'SELECT pg_advisory_xact_lock(:lock)', transaction, { lock: LOCK }));

      const userColumns = await requireColumns(queryInterface, 'users', ['id'], transaction);
      const permissionColumns = await requireColumns(queryInterface, 'permissions', ['id', 'code', 'name'], transaction);
      const roleColumns = await requireColumns(queryInterface, 'roles', ['id', 'name'], transaction);
      const rolePermissionColumns = await requireColumns(queryInterface, 'role_permissions', ['role_id', 'permission_id'], transaction);
      const overrideColumns = await ensureOverrideTable(queryInterface, Sequelize, transaction);
      const permissionTimestamps = timestampInsert(permissionColumns, ['created_at']);
      const permissionUpdatedAt = permissionColumns.has('updated_at');

      await operation('create presence table', () => query(queryInterface, `CREATE TABLE IF NOT EXISTS call_center_presence_sessions (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_identifier VARCHAR(180) NOT NULL,
        current_page VARCHAR(255),
        last_activity_at TIMESTAMPTZ NOT NULL,
        last_heartbeat_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(user_id, session_identifier)
      )`, transaction));
      await operation('create presence heartbeat index', () => query(
        queryInterface,
        'CREATE INDEX IF NOT EXISTS call_center_presence_heartbeat_idx ON call_center_presence_sessions(last_heartbeat_at DESC)',
        transaction
      ));
      await operation('create one-active-call index', () => query(
        queryInterface,
        'CREATE UNIQUE INDEX IF NOT EXISTS call_activities_one_active_per_agent_idx ON call_activities(agent_user_id) WHERE ended_at IS NULL',
        transaction
      ));

      for (const [code, name] of PERMISSIONS) {
        const permissionDescription = permissionColumns.has('description');
        await operation(`seed permission ${code}`, () => query(
          queryInterface,
          `INSERT INTO permissions(code,name${permissionDescription ? ',description' : ''}${permissionTimestamps.columns}${permissionUpdatedAt ? ',updated_at' : ''})
           VALUES(:code,:name${permissionDescription ? ',:name' : ''}${permissionTimestamps.values}${permissionUpdatedAt ? ',NOW()' : ''})
           ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name${permissionColumns.has('deleted_at') ? ',deleted_at=NULL' : ''}${permissionUpdatedAt ? ',updated_at=NOW()' : ''}`,
          transaction,
          { code, name }
        ));
      }

      if (userColumns.has('is_system_admin')) {
        const createdAt = overrideColumns.has('created_at');
        const updatedAt = overrideColumns.has('updated_at');
        await operation('grant supervisor permissions to system administrators', () => query(
          queryInterface,
          `INSERT INTO user_permission_overrides(user_id,permission_id,effect${createdAt ? ',created_at' : ''}${updatedAt ? ',updated_at' : ''})
           SELECT u.id,p.id,'allow'${createdAt ? ',NOW()' : ''}${updatedAt ? ',NOW()' : ''}
             FROM users u CROSS JOIN permissions p
            WHERE u.is_system_admin=TRUE
              ${userColumns.has('deleted_at') ? 'AND u.deleted_at IS NULL' : ''}
              AND p.code IN (:supervisorPermissionCodes)
           ON CONFLICT(user_id,permission_id) DO UPDATE
             SET effect=EXCLUDED.effect${updatedAt ? ',updated_at=NOW()' : ''}`,
          transaction,
          { supervisorPermissionCodes: SUPERVISOR_PERMISSION_CODES }
        ));
      }

      const roleGrantTimestamp = timestampInsert(rolePermissionColumns, ['granted_at', 'created_at']);
      await operation('grant supervisor permissions to canonical supervisor roles', () => query(
        queryInterface,
        `INSERT INTO role_permissions(role_id,permission_id${roleGrantTimestamp.columns})
         SELECT r.id,p.id${roleGrantTimestamp.values}
           FROM roles r CROSS JOIN permissions p
          WHERE LOWER(r.name) IN (:supervisorRoleNames)
            ${roleColumns.has('deleted_at') ? 'AND r.deleted_at IS NULL' : ''}
            AND p.code IN (:supervisorPermissionCodes)
         ON CONFLICT(role_id,permission_id) DO NOTHING`,
        transaction,
        { supervisorRoleNames: SUPERVISOR_ROLE_NAMES, supervisorPermissionCodes: SUPERVISOR_PERMISSION_CODES }
      ));
      await operation('preserve explicitly authorized supervisor roles', () => query(
        queryInterface,
        `INSERT INTO role_permissions(role_id,permission_id${roleGrantTimestamp.columns})
         SELECT DISTINCT existing.role_id,target.id${roleGrantTimestamp.values}
           FROM role_permissions existing
           JOIN permissions legacy ON legacy.id=existing.permission_id
           CROSS JOIN permissions target
          WHERE legacy.code IN (:legacySupervisorCodes)
            AND target.code IN (:supervisorPermissionCodes)
         ON CONFLICT(role_id,permission_id) DO NOTHING`,
        transaction,
        { legacySupervisorCodes: SUPERVISOR_LEGACY_PERMISSION_CODES, supervisorPermissionCodes: SUPERVISOR_PERMISSION_CODES }
      ));
      await operation('grant agent workspace only to existing agent-workspace roles', () => query(
        queryInterface,
        `INSERT INTO role_permissions(role_id,permission_id${roleGrantTimestamp.columns})
         SELECT DISTINCT existing.role_id,target.id${roleGrantTimestamp.values}
           FROM role_permissions existing
           JOIN permissions legacy ON legacy.id=existing.permission_id
           CROSS JOIN permissions target
          WHERE legacy.code IN (:legacyAgentCodes)
            AND target.code='call_center.agent_workspace'
         ON CONFLICT(role_id,permission_id) DO NOTHING`,
        transaction,
        { legacyAgentCodes: AGENT_LEGACY_PERMISSION_CODES }
      ));
    });
  },

  async down(queryInterface) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      await operation('acquire advisory migration lock', () =>
        query(queryInterface, 'SELECT pg_advisory_xact_lock(:lock)', transaction, { lock: LOCK }));
      await operation('drop one-active-call index', () =>
        query(queryInterface, 'DROP INDEX IF EXISTS call_activities_one_active_per_agent_idx', transaction));
      await operation('drop presence table', () =>
        query(queryInterface, 'DROP TABLE IF EXISTS call_center_presence_sessions', transaction));
    });
  }
};

module.exports.constants = {
  PERMISSIONS,
  SUPERVISOR_PERMISSION_CODES,
  AGENT_LEGACY_PERMISSION_CODES,
  SUPERVISOR_LEGACY_PERMISSION_CODES,
  SUPERVISOR_ROLE_NAMES
};
