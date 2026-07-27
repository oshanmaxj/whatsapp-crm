module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    const operation = (message) => console.log(`[050_assignment_history_actor] ${message}`);
    try {
      operation('acquiring advisory migration lock');
      if (queryInterface.sequelize.getDialect() === 'postgres') {
        await queryInterface.sequelize.query("SET LOCAL lock_timeout = '15s'", { transaction });
        await queryInterface.sequelize.query("SET LOCAL statement_timeout = '60s'", { transaction });
        await queryInterface.sequelize.query(
          "SELECT pg_advisory_xact_lock(hashtext('migration:050_assignment_history_actor'))",
          { transaction }
        );
      }
      operation('inspecting conversation_assignment_history');
      const columns = await queryInterface.describeTable('conversation_assignment_history', { transaction });
      if (!columns.actor_type) {
        operation('adding actor_type');
        await queryInterface.addColumn('conversation_assignment_history', 'actor_type', {
          type: Sequelize.STRING(30), allowNull: false, defaultValue: 'user'
        }, { transaction });
      } else {
        operation('actor_type already present');
      }
      if (!columns.source) {
        operation('adding source');
        await queryInterface.addColumn('conversation_assignment_history', 'source', {
          type: Sequelize.STRING(40), allowNull: false, defaultValue: 'chat_workspace'
        }, { transaction });
      } else {
        operation('source already present');
      }
      if (columns.changed_by_user_id?.allowNull === false) {
        operation('making changed_by_user_id nullable for explicit non-user actors');
        await queryInterface.changeColumn('conversation_assignment_history', 'changed_by_user_id', {
          type: Sequelize.BIGINT, allowNull: true
        }, { transaction });
      } else {
        operation('changed_by_user_id already nullable');
      }
      operation('committing');
      await transaction.commit();
    } catch (error) {
      operation(`rolling back after ${error.original?.code || error.parent?.code || error.code || error.name}`);
      await transaction.rollback();
      error.migrationOperation = 'add explicit assignment history actor';
      throw error;
    }
  },
  async down() {}
};
