async function columnExists(queryInterface, tableName, columnName) {
  const table = await queryInterface.describeTable(tableName).catch(() => null);
  return Boolean(table && Object.prototype.hasOwnProperty.call(table, columnName));
}

async function addColumn(queryInterface, tableName, columnName, definition) {
  if (!await columnExists(queryInterface, tableName, columnName)) {
    await queryInterface.addColumn(tableName, columnName, definition);
  }
}

async function indexExists(queryInterface, tableName, indexName) {
  const indexes = await queryInterface.showIndex(tableName).catch(() => []);
  return indexes.some((index) => index.name === indexName);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    await addColumn(queryInterface, 'messages', 'channel', {
      type: Sequelize.DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'whatsapp'
    });
    await addColumn(queryInterface, 'messages', 'message_type', {
      type: Sequelize.DataTypes.STRING(50),
      allowNull: true
    });
    await addColumn(queryInterface, 'messages', 'campaign_id', {
      type: Sequelize.DataTypes.BIGINT,
      allowNull: true,
      references: { model: 'campaigns', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
    await addColumn(queryInterface, 'messages', 'campaign_recipient_id', {
      type: Sequelize.DataTypes.BIGINT,
      allowNull: true,
      references: { model: 'campaign_recipients', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
    await addColumn(queryInterface, 'messages', 'is_internal_notification', {
      type: Sequelize.DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    });
    await addColumn(queryInterface, 'messages', 'sent_to_user_id', {
      type: Sequelize.DataTypes.BIGINT,
      allowNull: true
    });
    await addColumn(queryInterface, 'messages', 'sent_to_phone', {
      type: Sequelize.DataTypes.STRING(50),
      allowNull: true
    });
    await addColumn(queryInterface, 'conversations', 'last_message', {
      type: Sequelize.DataTypes.TEXT,
      allowNull: true
    });

    for (const [table, fields, name] of [
      ['messages', ['campaign_id'], 'messages_campaign_id_idx'],
      ['messages', ['campaign_recipient_id'], 'messages_campaign_recipient_id_idx'],
      ['messages', ['message_type'], 'messages_message_type_idx']
    ]) {
      if (!await indexExists(queryInterface, table, name)) {
        await queryInterface.addIndex(table, fields, { name });
      }
    }
  },

  async down(queryInterface) {
    for (const [table, name] of [
      ['messages', 'messages_message_type_idx'],
      ['messages', 'messages_campaign_recipient_id_idx'],
      ['messages', 'messages_campaign_id_idx']
    ]) {
      if (await indexExists(queryInterface, table, name)) {
        await queryInterface.removeIndex(table, name);
      }
    }
    for (const [table, column] of [
      ['conversations', 'last_message'],
      ['messages', 'sent_to_phone'],
      ['messages', 'sent_to_user_id'],
      ['messages', 'is_internal_notification'],
      ['messages', 'campaign_recipient_id'],
      ['messages', 'campaign_id'],
      ['messages', 'message_type'],
      ['messages', 'channel']
    ]) {
      if (await columnExists(queryInterface, table, column)) {
        await queryInterface.removeColumn(table, column);
      }
    }
  }
};
