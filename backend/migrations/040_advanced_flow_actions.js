async function tables(queryInterface) {
  return (await queryInterface.showAllTables()).map((row) => String(row.tableName || row).toLowerCase());
}
async function create(queryInterface, name, columns, transaction) {
  if (!(await tables(queryInterface)).includes(name)) await queryInterface.createTable(name, columns, { transaction });
}
async function addJson(queryInterface, Sequelize, table, column, transaction) {
  const definition = await queryInterface.describeTable(table);
  if (!definition[column]) await queryInterface.addColumn(table, column, { type: queryInterface.sequelize.getDialect() === 'postgres' ? Sequelize.DataTypes.JSONB : Sequelize.DataTypes.JSON, allowNull: false, defaultValue: {} }, { transaction });
}
module.exports = {
  async up(queryInterface, Sequelize) {
    const D = Sequelize.DataTypes;
    const json = queryInterface.sequelize.getDialect() === 'postgres' ? D.JSONB : D.JSON;
    await queryInterface.sequelize.transaction(async (transaction) => {
      const id = { type: D.BIGINT, autoIncrement: true, primaryKey: true };
      const dates = { created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }, updated_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') } };
      await addJson(queryInterface, Sequelize, 'contacts', 'custom_fields', transaction);
      await addJson(queryInterface, Sequelize, 'leads', 'custom_fields', transaction);
      await addJson(queryInterface, Sequelize, 'conversations', 'custom_fields', transaction);
      await create(queryInterface, 'contact_lists', { id, name: { type: D.STRING(150), allowNull: false, unique: true }, status: { type: D.STRING(30), allowNull: false, defaultValue: 'active' }, ...dates }, transaction);
      await create(queryInterface, 'contact_list_members', { id, contact_list_id: { type: D.BIGINT, allowNull: false }, contact_id: { type: D.BIGINT, allowNull: false }, source_flow_run_id: { type: D.BIGINT, allowNull: true }, ...dates }, transaction);
      await create(queryInterface, 'sequences', { id, name: { type: D.STRING(150), allowNull: false, unique: true }, status: { type: D.STRING(30), allowNull: false, defaultValue: 'active' }, ...dates }, transaction);
      await create(queryInterface, 'sequence_subscriptions', { id, sequence_id: { type: D.BIGINT, allowNull: false }, contact_id: { type: D.BIGINT, allowNull: false }, status: { type: D.STRING(30), allowNull: false, defaultValue: 'active' }, source_flow_run_id: { type: D.BIGINT, allowNull: true }, source_node_key: { type: D.STRING(120) }, source_button_id: { type: D.STRING(160) }, unsubscribed_at: { type: D.DATE }, ...dates }, transaction);
      await create(queryInterface, 'flow_run_links', { id, parent_flow_run_id: { type: D.BIGINT, allowNull: false }, child_flow_run_id: { type: D.BIGINT, allowNull: false, unique: true }, source_node_key: { type: D.STRING(120) }, created_at: dates.created_at }, transaction);
      await create(queryInterface, 'flow_action_executions', { id, flow_run_id: { type: D.BIGINT, allowNull: false }, node_key: { type: D.STRING(120), allowNull: false }, button_id: { type: D.STRING(160) }, action_type: { type: D.STRING(80), allowNull: false }, phase: { type: D.STRING(20), allowNull: false }, idempotency_key: { type: D.STRING(255), allowNull: false, unique: true }, status: { type: D.STRING(30), allowNull: false }, sanitized_input: { type: json, allowNull: false, defaultValue: {} }, sanitized_output: { type: json, allowNull: false, defaultValue: {} }, error_code: { type: D.STRING(100) }, error_message: { type: D.TEXT }, started_at: { type: D.DATE, allowNull: false }, completed_at: { type: D.DATE } }, transaction);
      const indexes = await queryInterface.showIndex('contact_list_members', { transaction });
      if (!indexes.some((item) => item.name === 'contact_list_members_unique')) await queryInterface.addIndex('contact_list_members', ['contact_list_id', 'contact_id'], { unique: true, name: 'contact_list_members_unique', transaction });
      const sequenceIndexes = await queryInterface.showIndex('sequence_subscriptions', { transaction });
      if (!sequenceIndexes.some((item) => item.name === 'sequence_subscriptions_unique')) await queryInterface.addIndex('sequence_subscriptions', ['sequence_id', 'contact_id'], { unique: true, name: 'sequence_subscriptions_unique', transaction });
    });
  },
  async down(queryInterface) {
    await queryInterface.sequelize.transaction(async (transaction) => {
      for (const table of ['flow_action_executions', 'flow_run_links', 'sequence_subscriptions', 'sequences', 'contact_list_members', 'contact_lists']) {
        if ((await tables(queryInterface)).includes(table)) await queryInterface.dropTable(table, { transaction });
      }
      for (const table of ['contacts', 'leads', 'conversations']) {
        const definition = await queryInterface.describeTable(table);
        if (definition.custom_fields) await queryInterface.removeColumn(table, 'custom_fields', { transaction });
      }
    });
  }
};
