async function columnExists(queryInterface, table, column) {
  const definition = await queryInterface.describeTable(table).catch(() => null);
  return Boolean(definition && Object.prototype.hasOwnProperty.call(definition, column));
}

async function addColumn(queryInterface, table, column, definition) {
  if (!await columnExists(queryInterface, table, column)) {
    await queryInterface.addColumn(table, column, definition);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const dialect = queryInterface.sequelize.getDialect();
    const jsonType = dialect === 'postgres' ? Sequelize.DataTypes.JSONB : Sequelize.DataTypes.JSON;
    await addColumn(queryInterface, 'flow_runs', 'error_message', { type: Sequelize.DataTypes.TEXT, allowNull: true });
    await addColumn(queryInterface, 'flow_runs', 'failed_node_id', { type: Sequelize.DataTypes.STRING(120), allowNull: true });
    await addColumn(queryInterface, 'flow_runs', 'failed_node_type', { type: Sequelize.DataTypes.STRING(120), allowNull: true });
    await addColumn(queryInterface, 'flow_runs', 'whatsapp_api_response', { type: jsonType, allowNull: true });
    await addColumn(queryInterface, 'flow_runs', 'payload_sent', { type: jsonType, allowNull: true });
  },
  async down(queryInterface) {
    for (const column of ['payload_sent', 'whatsapp_api_response', 'failed_node_type', 'failed_node_id', 'error_message']) {
      if (await columnExists(queryInterface, 'flow_runs', column)) {
        await queryInterface.removeColumn('flow_runs', column);
      }
    }
  }
};
