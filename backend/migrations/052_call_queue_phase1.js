const { inspectAllowedNextStatusType } = require('./helpers/call_center_schema');

const permissions = [
  ['call_queue.view_own', 'Call queue: view own'],
  ['call_queue.manage_own', 'Call queue: manage own'],
  ['call_queue.view_team', 'Call queue: view team'],
  ['call_queue.manage_team', 'Call queue: manage team'],
  ['call_queue.bulk_add', 'Call queue: bulk add'],
  ['call_queue.configure', 'Call queue: configure'],
  ['leads.call_unassigned', 'Call unassigned leads'],
  ['leads.call_others', 'Call leads assigned to others']
];

const roleGrants = Object.freeze({
  agent: ['call_queue.view_own', 'call_queue.manage_own', 'call_queue.bulk_add'],
  supervisor: ['call_queue.view_own', 'call_queue.manage_own', 'call_queue.view_team', 'call_queue.manage_team', 'call_queue.bulk_add'],
  admin: permissions.map(([code]) => code)
});

function tableNames(values) {
  return values.map(value => String(value?.tableName || value).toLowerCase());
}

async function describeIfPresent(queryInterface, name) {
  const names = tableNames(await queryInterface.showAllTables());
  return names.includes(name.toLowerCase()) ? queryInterface.describeTable(name) : null;
}

function resolveRoles(rows) {
  const normalized = rows.map(row => ({ id: row.id, name: row.name, key: String(row.name || '').trim().toLowerCase() }));
  const choose = (logical, aliases) => {
    const matches = aliases.flatMap(alias => normalized.filter(row => row.key === alias));
    if (!matches.length) throw new Error(`Preflight failed: required ${logical} role is absent (accepted names: ${aliases.join(', ')}).`);
    const selectedAlias = aliases.find(alias => matches.some(row => row.key === alias));
    const selected = matches.filter(row => row.key === selectedAlias);
    if (selected.length !== 1) throw new Error(`Preflight failed: ${logical} role name ${selectedAlias} is ambiguous.`);
    return { id: selected[0].id, name: selected[0].name };
  };
  return {
    agent: choose('Agent', ['agent']),
    supervisor: choose('Supervisor', ['supervisor', 'manager']),
    admin: choose('Admin', ['admin'])
  };
}

async function preflight(queryInterface, transaction = null) {
  if (queryInterface.sequelize.getDialect() !== 'postgres') throw new Error('Migration 052 requires PostgreSQL.');
  const allowedNextStatus = await inspectAllowedNextStatusType(queryInterface, transaction);
  const rolePermissionColumns = await describeIfPresent(queryInterface, 'role_permissions');
  if (!rolePermissionColumns) throw new Error('Preflight failed: role_permissions table is missing.');
  for (const required of ['role_id', 'permission_id']) {
    if (!rolePermissionColumns[required]) throw new Error(`Preflight failed: role_permissions.${required} is missing.`);
  }
  const roleColumns = await describeIfPresent(queryInterface, 'roles');
  if (!roleColumns) throw new Error('Preflight failed: roles table is missing.');
  const deletedPredicate = roleColumns.deleted_at ? 'WHERE deleted_at IS NULL' : '';
  const [roleRows] = await queryInterface.sequelize.query(
    `SELECT id,name FROM roles ${deletedPredicate} ORDER BY id`,
    { transaction }
  );
  const roles = resolveRoles(roleRows);
  const [existingPermissions] = await queryInterface.sequelize.query(
    'SELECT code FROM permissions WHERE code LIKE :prefix ORDER BY code',
    { replacements: { prefix: 'call_queue.%' }, transaction }
  );
  const queues = await describeIfPresent(queryInterface, 'call_queues');
  const entries = await describeIfPresent(queryInterface, 'call_queue_entries');
  const queueIndexes = queues ? await queryInterface.showIndex('call_queues', { transaction }) : [];
  const entryIndexes = entries ? await queryInterface.showIndex('call_queue_entries', { transaction }) : [];
  const [constraints] = await queryInterface.sequelize.query(
    `SELECT table_name,constraint_name,constraint_type
       FROM information_schema.table_constraints
      WHERE table_schema=current_schema()
        AND table_name IN ('call_queues','call_queue_entries','role_permissions')
      ORDER BY table_name,constraint_name`,
    { transaction }
  );
  const constraintsFor = table => constraints
    .filter(row => row.table_name === table)
    .map(row => ({ name: row.constraint_name, type: row.constraint_type }));
  return {
    allowedNextStatus: {
      dataType: allowedNextStatus.data_type,
      udtName: allowedNextStatus.udt_name,
      sqlType: allowedNextStatus.sqlType
    },
    rolePermissionColumns: Object.keys(rolePermissionColumns).sort(),
    roles,
    existingPermissions: existingPermissions.map(row => row.code),
    rolePermissionConstraints: constraintsFor('role_permissions'),
    callQueues: { exists: Boolean(queues), columns: queues ? Object.keys(queues).sort() : [], indexes: queueIndexes.map(row => row.name).sort(), constraints: constraintsFor('call_queues') },
    callQueueEntries: { exists: Boolean(entries), columns: entries ? Object.keys(entries).sort() : [], indexes: entryIndexes.map(row => row.name).sort(), constraints: constraintsFor('call_queue_entries') }
  };
}

async function operation(name, callback) {
  try {
    console.log(`[052_call_queue_phase1] ${name}`);
    return await callback();
  } catch (error) {
    error.migrationOperation = name;
    const original = error.original || error.parent || error;
    console.error('[052_call_queue_phase1] operation failed; transaction will roll back', {
      operation: name,
      message: original.message || error.message,
      sqlState: original.code || null,
      table: original.table || null,
      column: original.column || null,
      constraint: original.constraint || null
    });
    throw error;
  }
}

module.exports = {
  permissions,
  roleGrants,
  resolveRoles,
  preflight,
  async up(queryInterface, Sequelize) {
    const inspection = await preflight(queryInterface);
    console.log('[052_call_queue_phase1] preflight', inspection);
    return queryInterface.sequelize.transaction(async transaction => {
      await operation('acquire advisory migration lock', () =>
        queryInterface.sequelize.query("SELECT pg_advisory_xact_lock(hashtext('migration:052_call_queue_phase1'))", { transaction })
      );

      if (!inspection.callQueues.exists) await operation('create call_queues', () => queryInterface.createTable('call_queues', {
        id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
        agent_user_id: { type: Sequelize.BIGINT, allowNull: false },
        name: { type: Sequelize.STRING(120), allowNull: false, defaultValue: 'My Queue' },
        status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'active' },
        is_default: { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
      }, { transaction }));

      if (!inspection.callQueueEntries.exists) await operation('create call_queue_entries', () => queryInterface.createTable('call_queue_entries', {
        id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
        queue_id: { type: Sequelize.BIGINT, allowNull: false },
        lead_id: { type: Sequelize.BIGINT, allowNull: false },
        position: { type: Sequelize.INTEGER, allowNull: false },
        priority: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        status: { type: Sequelize.STRING(20), allowNull: false, defaultValue: 'pending' },
        source: { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'manual' },
        source_filter: { type: Sequelize.JSON },
        added_by_user_id: { type: Sequelize.BIGINT, allowNull: false },
        added_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        claimed_at: Sequelize.DATE,
        completed_at: Sequelize.DATE,
        snoozed_until: Sequelize.DATE,
        skip_reason: Sequelize.TEXT,
        last_call_activity_id: Sequelize.BIGINT,
        version: { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') },
        updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
      }, { transaction }));

      const queueIndexes = await queryInterface.showIndex('call_queues', { transaction });
      if (!queueIndexes.some(index => index.name === 'call_queues_agent_default_uq')) {
        await operation('create call_queues_agent_default_uq', () => queryInterface.addIndex('call_queues', ['agent_user_id'], {
          name: 'call_queues_agent_default_uq', unique: true, where: { is_default: true }, transaction
        }));
      }
      const entryIndexes = await queryInterface.showIndex('call_queue_entries', { transaction });
      if (!entryIndexes.some(index => index.name === 'call_queue_entries_active_lead_uq')) {
        await operation('create call_queue_entries_active_lead_uq', () => queryInterface.sequelize.query(
          "CREATE UNIQUE INDEX call_queue_entries_active_lead_uq ON call_queue_entries(queue_id,lead_id) WHERE status IN ('pending','calling','snoozed')",
          { transaction }
        ));
      }
      if (!entryIndexes.some(index => index.name === 'call_queue_entries_next_idx')) {
        await operation('create call_queue_entries_next_idx', () => queryInterface.addIndex(
          'call_queue_entries', ['queue_id', 'status', 'priority', 'position'],
          { name: 'call_queue_entries_next_idx', transaction }
        ));
      }

      const permissionColumns = await queryInterface.describeTable('permissions');
      const permissionTimestampColumns = ['created_at', 'updated_at'].filter(column => permissionColumns[column]);
      for (const [code, name] of permissions) {
        const columns = ['code', 'name', 'description', ...permissionTimestampColumns];
        const values = [':code', ':name', ':name', ...permissionTimestampColumns.map(() => 'NOW()')];
        await operation(`seed permission ${code}`, () => queryInterface.sequelize.query(
          `INSERT INTO permissions (${columns.join(',')}) VALUES (${values.join(',')}) ON CONFLICT (code) DO NOTHING`,
          { replacements: { code, name }, transaction }
        ));
      }

      const grantTimestamp = inspection.rolePermissionColumns.includes('granted_at') ? 'granted_at'
        : inspection.rolePermissionColumns.includes('created_at') ? 'created_at' : null;
      for (const [logicalRole, codes] of Object.entries(roleGrants)) {
        const role = inspection.roles[logicalRole];
        await operation(`grant ${logicalRole} queue permissions`, () => queryInterface.sequelize.query(
          `INSERT INTO role_permissions (role_id,permission_id${grantTimestamp ? `,${grantTimestamp}` : ''})
           SELECT :roleId,p.id${grantTimestamp ? ',NOW()' : ''}
             FROM permissions p
            WHERE p.code IN (:codes)
              AND NOT EXISTS (
                SELECT 1 FROM role_permissions rp
                 WHERE rp.role_id=:roleId AND rp.permission_id=p.id
              )
           ON CONFLICT DO NOTHING`,
          { replacements: { roleId: role.id, codes }, transaction }
        ));
      }
    });
  },
  async down() {}
};
