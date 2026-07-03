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
    await addColumn(queryInterface, 'campaigns', 'whatsapp_template_id', {
      type: Sequelize.DataTypes.BIGINT,
      allowNull: true,
      references: { model: 'whatsapp_templates', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
    await addColumn(queryInterface, 'campaign_recipients', 'queue_id', {
      type: Sequelize.DataTypes.BIGINT,
      allowNull: true,
      references: { model: 'message_queue', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
    await addColumn(queryInterface, 'campaign_recipients', 'external_message_id', {
      type: Sequelize.DataTypes.STRING(255),
      allowNull: true
    });
    await addColumn(queryInterface, 'campaign_recipients', 'variable_data', {
      type: Sequelize.DataTypes.JSON,
      allowNull: false,
      defaultValue: {}
    });
    await addColumn(queryInterface, 'message_queue', 'campaign_id', {
      type: Sequelize.DataTypes.BIGINT,
      allowNull: true,
      references: { model: 'campaigns', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
    await addColumn(queryInterface, 'message_queue', 'campaign_recipient_id', {
      type: Sequelize.DataTypes.BIGINT,
      allowNull: true,
      references: { model: 'campaign_recipients', key: 'id' },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL'
    });
  },

  async down(queryInterface) {
    for (const [table, column] of [
      ['message_queue', 'campaign_recipient_id'],
      ['message_queue', 'campaign_id'],
      ['campaign_recipients', 'variable_data'],
      ['campaign_recipients', 'external_message_id'],
      ['campaign_recipients', 'queue_id'],
      ['campaigns', 'whatsapp_template_id']
    ]) {
      if (await columnExists(queryInterface, table, column)) await queryInterface.removeColumn(table, column);
    }
  }
};
