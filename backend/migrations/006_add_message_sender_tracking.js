async function columnExists(queryInterface, tableName, columnName) {
  const table = await queryInterface.describeTable(tableName).catch(() => null);
  return Boolean(table && Object.prototype.hasOwnProperty.call(table, columnName));
}

async function indexExists(queryInterface, tableName, indexName) {
  const indexes = await queryInterface.showIndex(tableName).catch(() => []);
  return indexes.some((index) => index.name === indexName);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!await columnExists(queryInterface, 'messages', 'sent_by_user_id')) {
      await queryInterface.addColumn('messages', 'sent_by_user_id', {
        type: Sequelize.DataTypes.BIGINT,
        allowNull: true
      });
    }

    if (!await indexExists(queryInterface, 'messages', 'messages_sent_by_user_id_idx')) {
      await queryInterface.addIndex('messages', ['sent_by_user_id'], {
        name: 'messages_sent_by_user_id_idx'
      });
    }
  },

  async down(queryInterface) {
    if (await indexExists(queryInterface, 'messages', 'messages_sent_by_user_id_idx')) {
      await queryInterface.removeIndex('messages', 'messages_sent_by_user_id_idx');
    }
    if (await columnExists(queryInterface, 'messages', 'sent_by_user_id')) {
      await queryInterface.removeColumn('messages', 'sent_by_user_id');
    }
  }
};
