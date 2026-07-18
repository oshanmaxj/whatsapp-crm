module.exports = (sequelize, D) => sequelize.define('PaymentSlipDetectionJob', {
  id: { type: D.BIGINT, autoIncrement: true, primaryKey: true }, messageId: { type: D.BIGINT, allowNull: false, unique: true },
  status: { type: D.STRING(30), allowNull: false, defaultValue: 'QUEUED' }, attempts: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
  maxAttempts: { type: D.INTEGER, allowNull: false, defaultValue: 3 }, nextAttemptAt: D.DATE, lastError: D.TEXT, processedAt: D.DATE
}, { tableName: 'payment_slip_detection_jobs', timestamps: true, underscored: true });
