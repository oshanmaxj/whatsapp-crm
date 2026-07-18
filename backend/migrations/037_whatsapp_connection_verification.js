async function addColumn(queryInterface, table, column, definition) {
  const current = await queryInterface.describeTable(table);
  if (!Object.prototype.hasOwnProperty.call(current, column)) {
    await queryInterface.addColumn(table, column, definition);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const types = Sequelize.DataTypes;
    await addColumn(queryInterface, 'whatsapp_accounts', 'connection_status', { type: types.STRING(50), allowNull: true, defaultValue: 'connected' });
    await addColumn(queryInterface, 'whatsapp_accounts', 'connection_error', { type: types.TEXT, allowNull: true });
    await addColumn(queryInterface, 'whatsapp_accounts', 'verified_name', { type: types.STRING(255), allowNull: true });
    await addColumn(queryInterface, 'whatsapp_accounts', 'quality_rating', { type: types.STRING(50), allowNull: true });
    await addColumn(queryInterface, 'whatsapp_accounts', 'last_verified_at', { type: types.DATE, allowNull: true });
    await addColumn(queryInterface, 'whatsapp_accounts', 'send_enabled', { type: types.BOOLEAN, allowNull: false, defaultValue: true });
    await addColumn(queryInterface, 'messages', 'error_subcode', { type: types.STRING(100), allowNull: true });
  },

  async down(queryInterface) {
    const messages = await queryInterface.describeTable('messages');
    if (Object.prototype.hasOwnProperty.call(messages, 'error_subcode')) await queryInterface.removeColumn('messages', 'error_subcode');
    for (const column of ['connection_status', 'connection_error', 'verified_name', 'quality_rating', 'last_verified_at', 'send_enabled']) {
      const current = await queryInterface.describeTable('whatsapp_accounts');
      if (Object.prototype.hasOwnProperty.call(current, column)) await queryInterface.removeColumn('whatsapp_accounts', column);
    }
  }
};
