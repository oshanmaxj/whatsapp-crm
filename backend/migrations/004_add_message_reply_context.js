async function columnExists(queryInterface, tableName, columnName) {
  const tableDesc = await queryInterface.describeTable(tableName).catch(() => null);
  return Boolean(tableDesc && Object.prototype.hasOwnProperty.call(tableDesc, columnName));
}

async function indexExists(queryInterface, tableName, indexName) {
  const indexes = await queryInterface.showIndex(tableName).catch(() => []);
  return indexes.some((index) => index.name === indexName);
}

async function safeAddColumn(queryInterface, tableName, columnName, definition) {
  if (await columnExists(queryInterface, tableName, columnName)) return false;
  await queryInterface.addColumn(tableName, columnName, definition);
  return true;
}

async function safeAddIndex(queryInterface, tableName, fields, options) {
  const indexName = options.name;
  if (await indexExists(queryInterface, tableName, indexName)) return false;
  await queryInterface.addIndex(tableName, fields, options);
  return true;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await safeAddColumn(queryInterface, 'messages', 'reply_to_message_id', {
      type: Sequelize.DataTypes.BIGINT.UNSIGNED,
      allowNull: true,
      references: { model: 'messages', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
    await safeAddColumn(queryInterface, 'messages', 'reply_to_whatsapp_message_id', {
      type: Sequelize.DataTypes.STRING(255),
      allowNull: true
    });
    await safeAddIndex(queryInterface, 'messages', ['reply_to_message_id'], {
      name: 'messages_reply_to_message_id_idx'
    });
    await safeAddIndex(queryInterface, 'messages', ['reply_to_whatsapp_message_id'], {
      name: 'messages_reply_to_whatsapp_message_id_idx'
    });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('messages', 'messages_reply_to_whatsapp_message_id_idx').catch(() => {});
    await queryInterface.removeIndex('messages', 'messages_reply_to_message_id_idx').catch(() => {});
    await queryInterface.removeColumn('messages', 'reply_to_whatsapp_message_id').catch(() => {});
    await queryInterface.removeColumn('messages', 'reply_to_message_id').catch(() => {});
  }
};
