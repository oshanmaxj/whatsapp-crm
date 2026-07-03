module.exports = (sequelize, DataTypes) => {
  const FlowRunLog = sequelize.define('FlowRunLog', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    flowRunId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    nodeKey: { type: DataTypes.STRING(120), allowNull: false },
    nodeType: { type: DataTypes.STRING(80), allowNull: false },
    status: { type: DataTypes.STRING(40), allowNull: false },
    eventType: { type: DataTypes.STRING(60), allowNull: true },
    inputJson: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    outputJson: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    errorMessage: { type: DataTypes.TEXT, allowNull: true }
  }, {
    tableName: 'flow_run_logs',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    underscored: true,
    indexes: [{ fields: ['flow_run_id'] }, { fields: ['node_key'] }, { fields: ['status'] }]
  });

  FlowRunLog.associate = (models) => {
    FlowRunLog.belongsTo(models.FlowRun, { foreignKey: 'flow_run_id', as: 'run' });
  };

  return FlowRunLog;
};
