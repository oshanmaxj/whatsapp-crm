async function columnExists(queryInterface, tableName, columnName) {
  const table = await queryInterface.describeTable(tableName).catch(() => null);
  return Boolean(table && Object.prototype.hasOwnProperty.call(table, columnName));
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!await columnExists(queryInterface, 'roles', 'chat_visibility_scope')) {
      await queryInterface.addColumn('roles', 'chat_visibility_scope', {
        type: Sequelize.DataTypes.STRING(30),
        allowNull: false,
        defaultValue: 'assigned'
      });
    }

    await queryInterface.bulkUpdate(
      'roles',
      { chat_visibility_scope: 'all' },
      {
        [Sequelize.Op.or]: [
          Sequelize.where(Sequelize.fn('lower', Sequelize.col('name')), 'admin'),
          Sequelize.where(Sequelize.fn('lower', Sequelize.col('name')), 'manager')
        ]
      }
    );
  },

  async down(queryInterface) {
    if (await columnExists(queryInterface, 'roles', 'chat_visibility_scope')) {
      await queryInterface.removeColumn('roles', 'chat_visibility_scope');
    }
  }
};
