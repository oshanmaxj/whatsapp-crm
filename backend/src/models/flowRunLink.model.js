module.exports = (sequelize, DataTypes) => sequelize.define('FlowRunLink', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  parentFlowRunId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  childFlowRunId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, unique: true },
  sourceNodeKey: { type: DataTypes.STRING(120), allowNull: true },
  createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW }
}, { tableName: 'flow_run_links', timestamps: false, underscored: true });
