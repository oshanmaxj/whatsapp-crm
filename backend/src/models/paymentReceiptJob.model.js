module.exports = (sequelize, DataTypes) => sequelize.define('PaymentReceiptJob', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  receiptId: { type: DataTypes.BIGINT, allowNull: false },
  jobType: { type: DataTypes.STRING(30), allowNull: false, validate: { isIn: [['GENERATE_PDF', 'SEND_WHATSAPP']] } },
  dedupeKey: { type: DataTypes.STRING(180), allowNull: false, unique: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'QUEUED', validate: { isIn: [['QUEUED', 'PROCESSING', 'COMPLETED', 'ACCEPTED', 'DELIVERED', 'READ', 'FAILED']] } },
  attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  maxAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
  runAfter: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  actorUserId: { type: DataTypes.BIGINT, allowNull: true },
  manual: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  conversationId: { type: DataTypes.BIGINT, allowNull: true },
  whatsappAccountId: { type: DataTypes.BIGINT, allowNull: true },
  lastError: { type: DataTypes.TEXT, allowNull: true },
  lastErrorCode: { type: DataTypes.STRING(120), allowNull: true },
  externalMessageId: { type: DataTypes.STRING(255), allowNull: true },
  acceptedAt: { type: DataTypes.DATE, allowNull: true },
  deliveredAt: { type: DataTypes.DATE, allowNull: true },
  readAt: { type: DataTypes.DATE, allowNull: true },
  failedAt: { type: DataTypes.DATE, allowNull: true },
  terminal: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  completedAt: { type: DataTypes.DATE, allowNull: true }
}, {
  tableName: 'payment_receipt_jobs', timestamps: true, underscored: true,
  indexes: [{ fields: ['status', 'run_after'] }, { fields: ['receipt_id', 'job_type'] }]
});
