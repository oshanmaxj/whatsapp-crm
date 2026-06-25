module.exports = (sequelize, DataTypes) => {
  const FlowRun = sequelize.define('FlowRun', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    flowId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    contactId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    leadId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    currentNodeKey: { type: DataTypes.STRING(120), allowNull: true },
    status: { type: DataTypes.ENUM('running', 'completed', 'failed', 'simulated'), allowNull: false, defaultValue: 'running' },
    contextJson: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    completedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'flow_runs',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['flow_id'] }, { fields: ['contact_id'] }, { fields: ['lead_id'] }, { fields: ['status'] }]
  });

  FlowRun.associate = (models) => {
    FlowRun.belongsTo(models.Flow, { foreignKey: 'flow_id', as: 'flow' });
    FlowRun.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    FlowRun.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    FlowRun.hasMany(models.FlowRunLog, { foreignKey: 'flow_run_id', as: 'logs' });
  };

  return FlowRun;
};
