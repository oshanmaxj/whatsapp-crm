async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  return tables.some((table) => String(typeof table === 'string' ? table : table.tableName || table.table_name) === tableName);
}

async function addMissingColumns(queryInterface, Sequelize, transaction) {
  const columns = await queryInterface.describeTable('lead_activities', { transaction });
  const definitions = {
    actor_user_id: { type: Sequelize.BIGINT, allowNull: true },
    lead_id: { type: Sequelize.BIGINT, allowNull: true },
    action: { type: Sequelize.STRING(80), allowNull: true },
    old_value: { type: Sequelize.JSON, allowNull: true },
    new_value: { type: Sequelize.JSON, allowNull: true },
    note: { type: Sequelize.TEXT, allowNull: true },
    created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
  };
  for (const [column, definition] of Object.entries(definitions)) {
    if (!columns[column]) await queryInterface.addColumn('lead_activities', column, definition, { transaction });
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      if (!(await tableExists(queryInterface, 'lead_activities'))) {
        await queryInterface.createTable('lead_activities', {
          id: { type: Sequelize.BIGINT, autoIncrement: true, primaryKey: true },
          actor_user_id: { type: Sequelize.BIGINT, allowNull: true },
          lead_id: { type: Sequelize.BIGINT, allowNull: false },
          action: { type: Sequelize.STRING(80), allowNull: false },
          old_value: { type: Sequelize.JSON, allowNull: true },
          new_value: { type: Sequelize.JSON, allowNull: true },
          note: { type: Sequelize.TEXT, allowNull: true },
          created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.fn('NOW') }
        }, { transaction });
      } else {
        await addMissingColumns(queryInterface, Sequelize, transaction);
      }
      const indexes = await queryInterface.showIndex('lead_activities', { transaction });
      if (!indexes.some((index) => index.name === 'lead_activities_lead_created_idx')) {
        await queryInterface.addIndex('lead_activities', ['lead_id', 'created_at'], {
          name: 'lead_activities_lead_created_idx', transaction
        });
      }
    });
  },
  async down() {}
};
