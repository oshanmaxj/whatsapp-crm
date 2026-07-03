async function columnExists(queryInterface, tableName, columnName) {
  const table = await queryInterface.describeTable(tableName).catch(() => null);
  return Boolean(table && Object.prototype.hasOwnProperty.call(table, columnName));
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!await columnExists(queryInterface, 'roles', 'is_active')) {
      await queryInterface.addColumn('roles', 'is_active', {
        type: Sequelize.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      });
    }
    if (!await columnExists(queryInterface, 'roles', 'receive_department_assignment_notifications')) {
      await queryInterface.addColumn('roles', 'receive_department_assignment_notifications', {
        type: Sequelize.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
      });
    }
    if (!await columnExists(queryInterface, 'users', 'receive_assignment_notifications')) {
      await queryInterface.addColumn('users', 'receive_assignment_notifications', {
        type: Sequelize.DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: true
      });
    }
  },

  async down(queryInterface) {
    if (await columnExists(queryInterface, 'users', 'receive_assignment_notifications')) {
      await queryInterface.removeColumn('users', 'receive_assignment_notifications');
    }
    if (await columnExists(queryInterface, 'roles', 'receive_department_assignment_notifications')) {
      await queryInterface.removeColumn('roles', 'receive_department_assignment_notifications');
    }
    if (await columnExists(queryInterface, 'roles', 'is_active')) {
      await queryInterface.removeColumn('roles', 'is_active');
    }
  }
};
