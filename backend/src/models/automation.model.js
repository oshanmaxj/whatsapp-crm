module.exports = (sequelize, DataTypes) => {
  const Automation = sequelize.define('Automation', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(160), allowNull: false },
    code: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    category: {
      type: DataTypes.ENUM('Education', 'Finance', 'Marketing', 'System'),
      allowNull: false
    },
    enabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    channel: {
      type: DataTypes.ENUM('whatsapp', 'email', 'sms', 'notification', 'multi_channel'),
      allowNull: false,
      defaultValue: 'notification'
    },
    scheduleType: {
      type: DataTypes.ENUM('manual', 'hourly', 'daily', 'weekly', 'monthly'),
      allowNull: false,
      defaultValue: 'manual'
    },
    scheduleValue: { type: DataTypes.STRING(120), allowNull: true },
    lastRunAt: { type: DataTypes.DATE, allowNull: true },
    nextRunAt: { type: DataTypes.DATE, allowNull: true },
    successCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    failureCount: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 }
  }, {
    tableName: 'automations',
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ['code'] },
      { fields: ['category'] },
      { fields: ['enabled'] },
      { fields: ['next_run_at'] }
    ]
  });

  Automation.associate = (models) => {
    Automation.hasMany(models.AutomationLog, { foreignKey: 'automation_id', as: 'logs' });
  };

  return Automation;
};
