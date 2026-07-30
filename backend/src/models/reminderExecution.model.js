module.exports = (sequelize, D) => sequelize.define('ReminderExecution', {
  id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
  subscriptionId: { type: D.BIGINT, allowNull: false }, sequenceStepId: { type: D.BIGINT, allowNull: false },
  conversationId: { type: D.BIGINT, allowNull: false }, whatsappAccountId: { type: D.BIGINT, allowNull: false },
  scheduledAt: { type: D.DATE, allowNull: false }, startedAt: D.DATE, sentAt: D.DATE,
  status: { type: D.STRING(20), allowNull: false, defaultValue: 'scheduled' },
  messageId: D.BIGINT, queueId: D.BIGINT, whatsappMessageId: D.STRING(255),
  errorCode: D.STRING(80), errorMessage: D.TEXT, attemptCount: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
  nextRetryAt: D.DATE, metadata: { type: D.JSONB, allowNull: false, defaultValue: {} }
  , sequenceId: D.BIGINT, messageType: D.STRING(30), mediaRecordId: D.BIGINT,
  metaMediaId: D.STRING(255), templateId: D.BIGINT, serviceWindowDecision: D.STRING(40),
  buttonConfigurationSnapshot: { type: D.JSONB, allowNull: false, defaultValue: {} },
  deliveredAt: D.DATE, readAt: D.DATE, failedAt: D.DATE
}, { tableName: 'reminder_executions', timestamps: true, underscored: true });
