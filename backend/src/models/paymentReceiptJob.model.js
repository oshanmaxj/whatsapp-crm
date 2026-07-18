module.exports = (sequelize, DataTypes) => sequelize.define('PaymentReceiptJob', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  receiptId: { type: DataTypes.BIGINT, allowNull: false },
  jobType: { type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [['GENERATE_PDF', 'SEND_WHATSAPP']] } },
  dedupeKey: { type: DataTypes.STRING(180), allowNull: false, unique: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'QUEUED', validate: { isIn: [['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']] } },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  maxAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
  runAfter: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  actorUserId: { type: DataTypes.BIGINT, allowNull: true },
  manual: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  lastError: { type: DataTypes.TEXT, allowNull: true },
  completedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'payment_receipt_jobs', timestamps: true, underscored: true,
  indexes: [{ fields: ['status', 'run_after'] }, { fields: ['receipt_id', 'job_type'] }]
});
