module.exports = (sequelize, DataTypes) => sequelize.define('SequenceSubscription', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  sequenceId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  contactId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'active' },
  sourceFlowRunId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  sourceNodeKey: { type: DataTypes.STRING(120), allowNull: true },
  sourceButtonId: { type: DataTypes.STRING(160), allowNull: true },
  unsubscribedAt: { type: DataTypes.DATE, allowNull: true }
}, { tableName: 'sequence_subscriptions', timestamps: true, underscored: true, indexes: [{ unique: true, fields: ['sequence_id', 'contact_id'] }] });
