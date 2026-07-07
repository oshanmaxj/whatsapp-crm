module.exports = (sequelize, DataTypes) => {
  const WhatsAppAccount = sequelize.define('WhatsAppAccount', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    phoneNumber: { type: DataTypes.STRING(50), allowNull: true },
    phoneNumberId: { type: DataTypes.STRING(150), allowNull: false, unique: true },
    businessAccountId: { type: DataTypes.STRING(150), allowNull: true },
    accessTokenEncrypted: { type: DataTypes.TEXT, allowNull: false },
    webhookVerifyToken: { type: DataTypes.STRING(255), allowNull: true },
    appId: { type: DataTypes.STRING(150), allowNull: true },
    appSecretEncrypted: { type: DataTypes.TEXT, allowNull: true },
    apiVersion: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'v17.0' },
    apiBaseUrl: { type: DataTypes.STRING(255), allowNull: false, defaultValue: 'https://graph.facebook.com' },
    status: { type: DataTypes.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
    connectionStatus: { type: DataTypes.STRING(50), allowNull: true, defaultValue: 'connected' },
    connectionError: { type: DataTypes.TEXT, allowNull: true },
    isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    lastTestedAt: { type: DataTypes.DATE, allowNull: true },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'whatsapp_accounts',
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ['phone_number_id'] },
      { fields: ['status'] },
      { fields: ['is_default'] }
    ]
  });

  WhatsAppAccount.associate = (models) => {
    WhatsAppAccount.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };
  return WhatsAppAccount;
};
