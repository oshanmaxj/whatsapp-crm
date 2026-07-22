async function tableExists(queryInterface, name) {
  return (await queryInterface.showAllTables()).some((table) => {
    const tableName = typeof table === 'string' ? table : table.tableName || table.table_name || table.name;
    return String(tableName).toLowerCase() === name.toLowerCase();
  });
}
async function indexExists(queryInterface, table, name) {
  return (await queryInterface.showIndex(table).catch(() => [])).some((item) => item.name === name);
}
async function addIndex(queryInterface, table, fields, options, transaction) {
  if (!(await indexExists(queryInterface, table, options.name))) await queryInterface.addIndex(table, fields, { ...options, transaction });
}
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    await queryInterface.sequelize.transaction(async (transaction) => {
      const userColumns = await queryInterface.describeTable('users');
      if (!userColumns.is_available) await queryInterface.addColumn('users', 'is_available', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, { transaction });
      if (!userColumns.leave_until) await queryInterface.addColumn('users', 'leave_until', { type: DataTypes.DATE, allowNull: true }, { transaction });
      if (!userColumns.working_hours) await queryInterface.addColumn('users', 'working_hours', { type: DataTypes.JSON, allowNull: true }, { transaction });
      if (!(await tableExists(queryInterface, 'whatsapp_routing_rules'))) await queryInterface.createTable('whatsapp_routing_rules', {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        whatsapp_account_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'whatsapp_accounts', key: 'id' }, onDelete: 'CASCADE' },
        name: { type: DataTypes.STRING(150), allowNull: false }, is_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 }, assignment_strategy: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'least_open_chats' },
        department_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'roles', key: 'id' }, onDelete: 'SET NULL' },
        fallback_department_id: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'roles', key: 'id' }, onDelete: 'SET NULL' },
        fallback_agent_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        manager_user_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        respect_working_hours: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, sticky_assignment: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        reassign_if_unavailable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }, reassign_after_minutes: { type: DataTypes.INTEGER, allowNull: true },
        max_open_chats_per_agent: { type: DataTypes.INTEGER, allowNull: true }, allow_global_fallback: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        notify_manager_when_unassigned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }, last_assigned_agent_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        created_by: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }, deleted_at: { type: DataTypes.DATE, allowNull: true }
      }, { transaction });
      if (!(await tableExists(queryInterface, 'whatsapp_routing_rule_agents'))) await queryInterface.createTable('whatsapp_routing_rule_agents', {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true }, routing_rule_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'whatsapp_routing_rules', key: 'id' }, onDelete: 'CASCADE' },
        agent_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' }, weight: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 }, priority: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        max_open_chats: { type: DataTypes.INTEGER, allowNull: true }, is_enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      }, { transaction });
      if (!(await tableExists(queryInterface, 'whatsapp_routing_unassigned_queue'))) await queryInterface.createTable('whatsapp_routing_unassigned_queue', {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true }, whatsapp_account_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'whatsapp_accounts', key: 'id' }, onDelete: 'CASCADE' },
        routing_rule_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'whatsapp_routing_rules', key: 'id' }, onDelete: 'SET NULL' }, conversation_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'conversations', key: 'id' }, onDelete: 'CASCADE' },
        contact_id: { type: DataTypes.BIGINT, allowNull: false, references: { model: 'contacts', key: 'id' }, onDelete: 'CASCADE' }, lead_id: { type: DataTypes.BIGINT, allowNull: true, references: { model: 'leads', key: 'id' }, onDelete: 'SET NULL' },
        source_message_id: { type: DataTypes.STRING(255), allowNull: true }, exclusion_reasons: { type: DataTypes.JSON, allowNull: false, defaultValue: [] }, status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'open' }, resolved_at: { type: DataTypes.DATE, allowNull: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }, updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      }, { transaction });
      await addIndex(queryInterface, 'whatsapp_routing_rules', ['whatsapp_account_id', 'priority'], { name: 'wa_routing_rules_account_priority_idx' }, transaction);
      if (queryInterface.sequelize.getDialect() === 'postgres') await queryInterface.sequelize.query('CREATE UNIQUE INDEX IF NOT EXISTS wa_routing_one_active_rule_idx ON whatsapp_routing_rules (whatsapp_account_id) WHERE is_enabled = true AND deleted_at IS NULL', { transaction });
      await addIndex(queryInterface, 'whatsapp_routing_rule_agents', ['routing_rule_id', 'agent_id'], { name: 'wa_routing_rule_agent_unique_idx', unique: true }, transaction);
      await addIndex(queryInterface, 'whatsapp_routing_rule_agents', ['agent_id'], { name: 'wa_routing_agent_idx' }, transaction);
      await addIndex(queryInterface, 'whatsapp_routing_unassigned_queue', ['whatsapp_account_id', 'status', 'created_at'], { name: 'wa_routing_unassigned_account_status_idx' }, transaction);
      const permissions = ['whatsapp_routing.view','whatsapp_routing.create','whatsapp_routing.edit','whatsapp_routing.delete','whatsapp_routing.test','whatsapp_routing.manage_agents'];
      for (const code of permissions) {
        await queryInterface.sequelize.query('INSERT INTO permissions (code, name, description, created_at, updated_at) SELECT :code, :code, :description, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code = :code)', { replacements: { code, description: `WhatsApp routing permission: ${code}` }, transaction });
      }
      await queryInterface.sequelize.query(`INSERT INTO role_permissions (role_id, permission_id, granted_at) SELECT r.id, p.id, CURRENT_TIMESTAMP FROM roles r CROSS JOIN permissions p WHERE LOWER(r.name) = 'admin' AND p.code IN (:permissions) AND NOT EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_id = r.id AND rp.permission_id = p.id)`, { replacements: { permissions }, transaction });
    });
  },
  async down() {}
};
