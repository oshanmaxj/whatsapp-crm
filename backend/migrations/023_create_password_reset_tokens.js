async function tableExists(queryInterface, tableName) {
  const tables = await queryInterface.showAllTables();
  return tables.map((table) => (typeof table === 'object' ? table.tableName || table.name : table)).includes(tableName);
}

async function indexExists(queryInterface, tableName, indexName) {
  const indexes = await queryInterface.showIndex(tableName).catch(() => []);
  return indexes.some((index) => index.name === indexName);
}

async function addIndex(queryInterface, tableName, fields, options) {
  if (!await indexExists(queryInterface, tableName, options.name)) {
    await queryInterface.addIndex(tableName, fields, options);
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (!await tableExists(queryInterface, 'password_reset_tokens')) {
      await queryInterface.createTable('password_reset_tokens', {
        id: { type: Sequelize.DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
        user_id: {
          type: Sequelize.DataTypes.BIGINT.UNSIGNED,
          allowNull: false,
          references: { model: 'users', key: 'id' },
          onDelete: 'CASCADE'
        },
        token_hash: { type: Sequelize.DataTypes.STRING(255), allowNull: false },
        expires_at: { type: Sequelize.DataTypes.DATE, allowNull: false },
        used_at: { type: Sequelize.DataTypes.DATE, allowNull: true },
        created_at: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: Sequelize.DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
    }

    await addIndex(queryInterface, 'password_reset_tokens', ['user_id'], { name: 'password_reset_tokens_user_id_idx' });
    await addIndex(queryInterface, 'password_reset_tokens', ['token_hash'], { name: 'password_reset_tokens_token_hash_idx' });
  },

  async down(queryInterface) {
    if (await tableExists(queryInterface, 'password_reset_tokens')) {
      await queryInterface.dropTable('password_reset_tokens');
    }
  }
};
