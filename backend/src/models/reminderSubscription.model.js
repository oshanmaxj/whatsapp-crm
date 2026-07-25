module.exports = (sequelize, D) => sequelize.define('ReminderSubscription', {
  id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
  sequenceId: { type: D.BIGINT, allowNull: false }, contactId: { type: D.BIGINT, allowNull: false },
  conversationId: { type: D.BIGINT, allowNull: false }, whatsappAccountId: { type: D.BIGINT, allowNull: false },
  phone: { type: D.STRING(50), allowNull: false }, leadId: D.BIGINT, studentId: D.BIGINT,
  status: { type: D.STRING(30), allowNull: false, defaultValue: 'active' },
  currentStep: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
  subscribedAt: { type: D.DATE, allowNull: false, defaultValue: D.NOW }, nextRunAt: D.DATE,
  completedAt: D.DATE, cancelledAt: D.DATE, subscribedBy: D.BIGINT,
  subscriptionSource: { type: D.STRING(30), allowNull: false, defaultValue: 'api' },
  sourceReferenceId: D.STRING(160), metadata: { type: D.JSONB, allowNull: false, defaultValue: {} }
}, { tableName: 'reminder_subscriptions', timestamps: true, underscored: true });
