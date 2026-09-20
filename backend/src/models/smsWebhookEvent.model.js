// Provider-neutral idempotency ledger, mirrors facebook_webhook_events.
// `provider` records which adapter delivered the event; the table itself
// has no SMSGo-specific concept in it.
module.exports = (sequelize, DataTypes) => {
  const SmsWebhookEvent = sequelize.define('SmsWebhookEvent', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    eventKey: { type: DataTypes.STRING(255), allowNull: false, unique: true, field: 'event_key' },
    provider: { type: DataTypes.STRING(40), allowNull: false },
    eventType: { type: DataTypes.STRING(64), allowNull: false, field: 'event_type' },
    payload: { type: DataTypes.JSONB, allowNull: false },
    receivedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'received_at' },
    processedAt: { type: DataTypes.DATE, allowNull: true, field: 'processed_at' },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'received' },
    errorDetails: { type: DataTypes.TEXT, allowNull: true, field: 'error_details' }
  }, {
    tableName: 'sms_webhook_events',
    timestamps: false,
    underscored: true,
    indexes: [
      { unique: true, fields: ['event_key'] },
      { fields: ['provider'], name: 'sms_webhook_events_provider_idx' },
      { fields: ['status'], name: 'sms_webhook_events_status_idx' }
    ]
  });

  return SmsWebhookEvent;
};
