module.exports = (sequelize, DataTypes) => {
  const GoogleSheetConnection = sequelize.define('GoogleSheetConnection', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(180), allowNull: false },
    spreadsheetId: { type: DataTypes.STRING(255), allowNull: false },
    sheetName: { type: DataTypes.STRING(180), allowNull: false, defaultValue: 'Leads' },
    authType: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'service_account' },
    serviceAccountEmail: { type: DataTypes.STRING(255), allowNull: true },
    encryptedPrivateKey: { type: DataTypes.TEXT, allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  }, {
    tableName: 'google_sheet_connections',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['is_active'] }]
  });

  return GoogleSheetConnection;
};
