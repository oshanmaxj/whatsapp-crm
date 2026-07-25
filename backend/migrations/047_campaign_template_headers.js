async function columnExists(queryInterface, table, column) {
  const columns = await queryInterface.describeTable(table);
  return Boolean(columns[column]);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!await columnExists(queryInterface, 'campaigns', 'header_media')) {
      await queryInterface.addColumn('campaigns', 'header_media', {
        type: Sequelize.DataTypes.JSONB,
        allowNull: true
      });
    }
    if (!await columnExists(queryInterface, 'campaigns', 'header_text')) {
      await queryInterface.addColumn('campaigns', 'header_text', {
        type: Sequelize.DataTypes.TEXT,
        allowNull: true
      });
    }
    if (queryInterface.sequelize.getDialect() === 'postgres') {
      await queryInterface.sequelize.query(
        `ALTER TYPE "enum_campaigns_status" ADD VALUE IF NOT EXISTS 'Completed with failures'`
      );
    }
  },
  async down() {}
};
