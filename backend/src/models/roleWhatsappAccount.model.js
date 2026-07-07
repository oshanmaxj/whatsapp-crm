module.exports = (sequelize, DataTypes) => sequelize.define('RoleWhatsAppAccount', {
  id: {
    type: DataTypes.BIGINT,
    autoIncrement: true,
    primaryKey: true,
    field: 'id'
  },
  roleId: {
    type: DataTypes.BIGINT,
    allowNull: false,
    field: 'role_id'
  },
  whatsappAccountId: {
    type: DataTypes.BIGINT,
    allowNull: false,
    field: 'whatsapp_account_id'
  }
}, {
  tableName: 'role_whatsapp_accounts',
  timestamps: true,
  underscored: true,
  indexes: [
    { unique: true, fields: ['role_id', 'whatsapp_account_id'], name: 'role_whatsapp_accounts_role_account_unique' },
    { fields: ['role_id'], name: 'role_whatsapp_accounts_role_id_idx' },
    { fields: ['whatsapp_account_id'], name: 'role_whatsapp_accounts_whatsapp_account_id_idx' }
  ]
});
