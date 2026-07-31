module.exports = (sequelize, D) => sequelize.define('ReminderSequence', {
  id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
  name: { type: D.STRING(180), allowNull: false },
  description: D.TEXT,
  whatsappAccountId: D.BIGINT,
  status: { type: D.STRING(20), allowNull: false, defaultValue: 'draft' },
  stopOnCustomerReply: { type: D.BOOLEAN, allowNull: false, defaultValue: true },
  replyPolicy: { type: D.STRING(30), allowNull: true },
  replyCooldownValue: { type: D.INTEGER, allowNull: false, defaultValue: 4 },
  replyCooldownUnit: { type: D.STRING(10), allowNull: false, defaultValue: 'hours' },
  stopOnLeadConverted: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
  stopOnPaymentConfirmed: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
  stopOnLabelAdded: D.BIGINT,
  timezone: { type: D.STRING(80), allowNull: false, defaultValue: 'Asia/Colombo' },
  createdBy: D.BIGINT, updatedBy: D.BIGINT, deletedAt: D.DATE
}, { tableName: 'reminder_sequences', timestamps: true, paranoid: true, underscored: true });
