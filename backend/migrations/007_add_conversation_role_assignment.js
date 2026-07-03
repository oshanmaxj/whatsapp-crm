async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  return tables.some((table) => (
    String(typeof table === 'object' ? table.tableName || table.table_name : table).toLowerCase() === tableName
  ));
}

async function columnExists(queryInterface, tableName, columnName) {
  const table = await queryInterface.describeTable(tableName).catch(() => null);
  return Boolean(table && Object.prototype.hasOwnProperty.call(table, columnName));
}

async function indexExists(queryInterface, tableName, indexName) {
  const indexes = await queryInterface.showIndex(tableName).catch(() => []);
  return indexes.some((index) => index.name === indexName);
}

async function ensureRoles(queryInterface, Sequelize, names) {
  const uniqueNames = [...new Set(names.map((name) => String(name || '').trim()).filter(Boolean))];
  const existing = await queryInterface.sequelize.query(
    'SELECT id, name FROM roles WHERE deleted_at IS NULL',
    { type: Sequelize.QueryTypes.SELECT }
  );
  const byName = new Map(existing.map((role) => [String(role.name).toLowerCase(), role]));
  const now = new Date();

  for (const name of uniqueNames) {
    const key = name.toLowerCase();
    if (byName.has(key)) continue;
    await queryInterface.bulkInsert('roles', [{
      name: key,
      description: `Conversation department/team migrated from ${name}`,
      chat_visibility_scope: 'role_and_assigned',
      created_at: now,
      updated_at: now,
      deleted_at: null
    }]);
    const [created] = await queryInterface.sequelize.query(
      'SELECT id, name FROM roles WHERE LOWER(name) = LOWER(:name) AND deleted_at IS NULL ORDER BY id LIMIT 1',
      { replacements: { name: key }, type: Sequelize.QueryTypes.SELECT }
    );
    byName.set(key, created);
  }

  return byName;
}

async function attachUsersToRoles(queryInterface, Sequelize, assignments) {
  if (!assignments.length) return;
  const existing = await queryInterface.sequelize.query(
    'SELECT user_id, role_id FROM user_roles',
    { type: Sequelize.QueryTypes.SELECT }
  );
  const keys = new Set(existing.map((row) => `${row.user_id}:${row.role_id}`));
  const assignedAt = new Date();
  const inserts = [];
  assignments.forEach(({ userId, roleId }) => {
    const key = `${userId}:${roleId}`;
    if (!userId || !roleId || keys.has(key)) return;
    keys.add(key);
    inserts.push({ user_id: userId, role_id: roleId, assigned_at: assignedAt });
  });
  if (inserts.length) await queryInterface.bulkInsert('user_roles', inserts);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!await columnExists(queryInterface, 'conversations', 'assigned_role_id')) {
      await queryInterface.addColumn('conversations', 'assigned_role_id', {
        type: Sequelize.DataTypes.INTEGER,
        allowNull: true,
        references: { model: 'roles', key: 'id' },
        onUpdate: 'CASCADE',
        onDelete: 'SET NULL'
      });
    }

    const hasAssignedTo = await columnExists(queryInterface, 'conversations', 'assigned_to');
    const hasAssignedUserId = await columnExists(queryInterface, 'conversations', 'assigned_user_id');
    if (hasAssignedTo && !hasAssignedUserId) {
      await queryInterface.renameColumn('conversations', 'assigned_to', 'assigned_user_id');
    } else if (hasAssignedTo && hasAssignedUserId) {
      await queryInterface.sequelize.query(
        'UPDATE conversations SET assigned_user_id = assigned_to WHERE assigned_user_id IS NULL'
      );
      await queryInterface.removeColumn('conversations', 'assigned_to');
    }

    const roleNames = [];
    let departments = [];
    if (await tableExists(queryInterface, 'departments')) {
      departments = await queryInterface.sequelize.query(
        'SELECT id, name FROM departments',
        { type: Sequelize.QueryTypes.SELECT }
      );
      roleNames.push(...departments.map((department) => department.name));
    }

    const hasLegacyDepartment = await columnExists(queryInterface, 'users', 'department');
    const legacyUsers = hasLegacyDepartment
      ? await queryInterface.sequelize.query(
          "SELECT id, department::text AS department FROM users WHERE department IS NOT NULL AND TRIM(department::text) <> ''",
          { type: Sequelize.QueryTypes.SELECT }
        )
      : [];
    roleNames.push(...legacyUsers.map((user) => user.department));

    const rolesByName = await ensureRoles(queryInterface, Sequelize, roleNames);
    const roleByDepartmentId = new Map(
      departments.map((department) => [
        String(department.id),
        rolesByName.get(String(department.name).toLowerCase())?.id
      ])
    );

    if (departments.length && await columnExists(queryInterface, 'conversations', 'department_id')) {
      for (const [departmentId, roleId] of roleByDepartmentId.entries()) {
        if (!roleId) continue;
        await queryInterface.sequelize.query(
          'UPDATE conversations SET assigned_role_id = :roleId WHERE department_id = :departmentId AND assigned_role_id IS NULL',
          { replacements: { roleId, departmentId } }
        );
      }
    }

    const userRoleAssignments = [];
    if (await columnExists(queryInterface, 'users', 'department_id')) {
      const usersWithDepartment = await queryInterface.sequelize.query(
        'SELECT id, department_id FROM users WHERE department_id IS NOT NULL',
        { type: Sequelize.QueryTypes.SELECT }
      );
      usersWithDepartment.forEach((user) => {
        userRoleAssignments.push({
          userId: user.id,
          roleId: roleByDepartmentId.get(String(user.department_id))
        });
      });
    }
    legacyUsers.forEach((user) => {
      userRoleAssignments.push({
        userId: user.id,
        roleId: rolesByName.get(String(user.department).toLowerCase())?.id
      });
    });
    await attachUsersToRoles(queryInterface, Sequelize, userRoleAssignments);

    await queryInterface.bulkUpdate('roles', { chat_visibility_scope: 'role_only' }, { chat_visibility_scope: 'department_only' });
    await queryInterface.bulkUpdate('roles', { chat_visibility_scope: 'role_and_assigned' }, { chat_visibility_scope: 'department_and_assigned' });

    if (await columnExists(queryInterface, 'conversations', 'department_id')) {
      await queryInterface.removeColumn('conversations', 'department_id');
    }
    if (await columnExists(queryInterface, 'users', 'department_id')) {
      await queryInterface.removeColumn('users', 'department_id');
    }
    if (await columnExists(queryInterface, 'users', 'department')) {
      await queryInterface.removeColumn('users', 'department');
    }
    if (await tableExists(queryInterface, 'departments')) {
      await queryInterface.dropTable('departments');
    }

    if (!await indexExists(queryInterface, 'conversations', 'conversations_assigned_role_id_idx')) {
      await queryInterface.addIndex('conversations', ['assigned_role_id'], { name: 'conversations_assigned_role_id_idx' });
    }
    if (!await indexExists(queryInterface, 'conversations', 'conversations_assigned_user_id_idx')) {
      await queryInterface.addIndex('conversations', ['assigned_user_id'], { name: 'conversations_assigned_user_id_idx' });
    }
  },

  async down(queryInterface) {
    if (await columnExists(queryInterface, 'conversations', 'assigned_role_id')) {
      await queryInterface.removeColumn('conversations', 'assigned_role_id');
    }
    if (
      await columnExists(queryInterface, 'conversations', 'assigned_user_id')
      && !await columnExists(queryInterface, 'conversations', 'assigned_to')
    ) {
      await queryInterface.renameColumn('conversations', 'assigned_user_id', 'assigned_to');
    }
  }
};
