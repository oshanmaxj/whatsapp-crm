module.exports = (sequelize, DataTypes) => {
  const WorkflowRun = sequelize.define('WorkflowRun', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    workflowId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    triggerType: { type: DataTypes.STRING(80), allowNull: false },
    status: {
      type: DataTypes.ENUM('running', 'completed', 'failed', 'simulated'),
      allowNull: false,
      defaultValue: 'running'
    },
    context: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    results: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    errorMessage: { type: DataTypes.TEXT, allowNull: true },
    startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    finishedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'workflow_runs',
    timestamps: true,
    updatedAt: false,
    underscored: true,
    indexes: [{ fields: ['workflow_id'] }, { fields: ['status'] }]
  });

  WorkflowRun.associate = (models) => {
    WorkflowRun.belongsTo(models.Workflow, { foreignKey: 'workflow_id', as: 'workflow' });
  };

  return WorkflowRun;
};
