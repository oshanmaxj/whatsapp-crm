module.exports = (sequelize, D) => {
  const AccountingReportingEpoch = sequelize.define('AccountingReportingEpoch', {
    id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
    trackingStartedAt: { type: D.DATE, allowNull: false },
    changedByUserId: { type: D.BIGINT, allowNull: true },
    changedAt: { type: D.DATE, allowNull: false, defaultValue: D.NOW },
    reason: { type: D.TEXT, allowNull: false },
    previousTrackingStartedAt: { type: D.DATE, allowNull: true },
    timezone: { type: D.STRING(80), allowNull: false, defaultValue: 'Asia/Colombo' }
  }, { tableName: 'accounting_reporting_epochs', timestamps: false, underscored: true });
  AccountingReportingEpoch.associate = models => AccountingReportingEpoch.belongsTo(models.User, { foreignKey: 'changed_by_user_id', as: 'changedBy' });
  return AccountingReportingEpoch;
};
