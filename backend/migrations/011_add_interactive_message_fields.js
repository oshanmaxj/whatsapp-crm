async function columnExists(queryInterface, tableName, columnName) {
  const table = await queryInterface.describeTable(tableName).catch(() => null);
  return Boolean(table && Object.prototype.hasOwnProperty.call(table, columnName));
}

async function addColumn(queryInterface, tableName, columnName, definition) {
  if (!await columnExists(queryInterface, tableName, columnName)) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumn(queryInterface, 'messages', 'button_payload', {
      type: Sequelize.DataTypes.TEXT,
      allowNull: true
    });
    await addColumn(queryInterface, 'messages', 'interactive_type', {
      type: Sequelize.DataTypes.STRING(100),
      allowNull: true
    });
    await addColumn(queryInterface, 'messages', 'raw_payload', {
      type: queryInterface.sequelize.getDialect() === 'postgres'
        ? Sequelize.DataTypes.JSONB
        : Sequelize.DataTypes.JSON,
      allowNull: true
    });
  },

  async down(queryInterface) {
    for (const column of ['interactive_type', 'button_payload']) {
      if (await columnExists(queryInterface, 'messages', column)) {
        await queryInterface.removeColumn('messages', column);
      }
    }
  }
};
