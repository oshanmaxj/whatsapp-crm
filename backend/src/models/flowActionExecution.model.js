module.exports = (sequelize, DataTypes) => sequelize.define('FlowActionExecution', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  flowRunId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  nodeKey: { type: DataTypes.STRING(120), allowNull: false },
  buttonId: { type: DataTypes.STRING(160), allowNull: true },
  actionType: { type: DataTypes.STRING(80), allowNull: false },
  phase: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pre' },
  idempotencyKey: { type: DataTypes.STRING(255), allowNull: false, unique: true },
  status: { type: DataTypes.STRING(30), allowNull: false },
  sanitizedInput: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  sanitizedOutput: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
  errorCode: { type: DataTypes.STRING(100), allowNull: true },
  errorMessage: { type: DataTypes.TEXT, allowNull: true },
  startedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  completedAt: { type: DataTypes.DATE, allowNull: true }
}, { tableName: 'flow_action_executions', timestamps: false, underscored: true });
