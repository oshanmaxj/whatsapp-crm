module.exports = (sequelize, DataTypes) => sequelize.define('UserWhatsAppAccount', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.BIGINT, allowNull: false, field: 'user_id' },
  whatsappAccountId: { type: DataTypes.BIGINT, allowNull: false, field: 'whatsapp_account_id' }
}, {
  tableName: 'user_whatsapp_accounts',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['user_id', 'whatsapp_account_id'], name: 'user_whatsapp_accounts_user_account_uq' },
    { fields: ['user_id'], name: 'user_whatsapp_accounts_user_idx' },
    { fields: ['whatsapp_account_id'], name: 'user_whatsapp_accounts_account_idx' }
  ]
});
