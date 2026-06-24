module.exports = (sequelize, DataTypes) => {
  const AppSetting = sequelize.define('AppSetting', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    namespace: { type: DataTypes.STRING(80), allowNull: false },
    key: { type: DataTypes.STRING(120), allowNull: false },
    value: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    isSecret: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    updatedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'app_settings',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['namespace', 'key'] }]
  });

  AppSetting.associate = (models) => {
    AppSetting.belongsTo(models.User, { foreignKey: 'updated_by', as: 'editor' });
  };

  return AppSetting;
};
