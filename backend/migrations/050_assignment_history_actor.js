async function columnExists(queryInterface, table, column) {
  const columns = await queryInterface.describeTable(table);
  return Boolean(columns[column]);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      if (!await columnExists(queryInterface, 'conversation_assignment_history', 'actor_type')) {
        await queryInterface.addColumn('conversation_assignment_history', 'actor_type', {
          type: Sequelize.STRING(30), allowNull: false, defaultValue: 'user'
        }, { transaction });
      }
      if (!await columnExists(queryInterface, 'conversation_assignment_history', 'source')) {
        await queryInterface.addColumn('conversation_assignment_history', 'source', {
          type: Sequelize.STRING(40), allowNull: false, defaultValue: 'chat_workspace'
        }, { transaction });
      }
      await queryInterface.changeColumn('conversation_assignment_history', 'changed_by_user_id', {
        type: Sequelize.BIGINT, allowNull: true
      }, { transaction });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      error.migrationOperation = 'add explicit assignment history actor';
      throw error;
    }
  },
  async down() {}
};
