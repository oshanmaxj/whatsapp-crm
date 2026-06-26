module.exports = (sequelize, DataTypes) => {
  const AutomationLog = sequelize.define('AutomationLog', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    automationId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    status: {
      type: DataTypes.ENUM('running', 'success', 'failed'),
      allowNull: false,
      defaultValue: 'running'
    },
    message: { type: DataTypes.TEXT, allowNull: true },
    startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    completedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'automation_logs',
    timestamps: true,
    updatedAt: false,
    underscored: true,
    indexes: [
      { fields: ['automation_id'] },
      { fields: ['status'] },
      { fields: ['started_at'] }
    ]
  });

  AutomationLog.associate = (models) => {
    AutomationLog.belongsTo(models.Automation, { foreignKey: 'automation_id', as: 'automation' });
  };

  return AutomationLog;
};
