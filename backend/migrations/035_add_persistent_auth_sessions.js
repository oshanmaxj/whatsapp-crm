async function tableExists(queryInterface, table, transaction) {
  return Boolean(await queryInterface.describeTable(table, { transaction }).catch(() => null));
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (await tableExists(queryInterface, 'auth_sessions')) return;
    const D = Sequelize.DataTypes;
    await queryInterface.createTable('auth_sessions', {
      id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
      user_id: { type: D.BIGINT, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
      token_hash: { type: D.STRING(64), allowNull: false },
      expires_at: { type: D.DATE, allowNull: false }, last_used_at: { type: D.DATE, allowNull: true },
      revoked_at: { type: D.DATE, allowNull: true }, ip_address: { type: D.STRING(64), allowNull: true },
      user_agent: { type: D.STRING(500), allowNull: true },
      created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
    });
    await queryInterface.addIndex('auth_sessions', ['user_id', 'revoked_at'], { name: 'auth_sessions_user_active_idx' });
    await queryInterface.addIndex('auth_sessions', ['expires_at'], { name: 'auth_sessions_expiry_idx' });
  },
  async down() {
    // Data-retaining migration. Old application versions ignore this additive table.
  }
};
