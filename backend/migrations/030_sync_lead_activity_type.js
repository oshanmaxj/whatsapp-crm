module.exports = {
  async up(queryInterface, Sequelize) {
    return queryInterface.sequelize.transaction(async (transaction) => {
      let columns = await queryInterface.describeTable('lead_activities', { transaction });
      if (!columns.activity_type) {
        await queryInterface.addColumn('lead_activities', 'activity_type', {
          type: Sequelize.STRING(80),
          allowNull: true
        }, { transaction });
        columns = await queryInterface.describeTable('lead_activities', { transaction });
      }
      if (!columns.action) {
        await queryInterface.addColumn('lead_activities', 'action', {
          type: Sequelize.STRING(80),
          allowNull: true
        }, { transaction });
      }

      await queryInterface.sequelize.query(
        `UPDATE lead_activities
         SET activity_type = COALESCE(activity_type, action, 'UNKNOWN'),
             action = COALESCE(action, activity_type, 'UNKNOWN')
         WHERE activity_type IS NULL OR action IS NULL`,
        { transaction }
      );
      await queryInterface.changeColumn('lead_activities', 'activity_type', {
        type: Sequelize.STRING(80), allowNull: false
      }, { transaction });
      await queryInterface.changeColumn('lead_activities', 'action', {
        type: Sequelize.STRING(80), allowNull: false
      }, { transaction });
    });
  },
  async down() {}
};
