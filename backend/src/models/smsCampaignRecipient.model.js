// Each row IS the queue item for that recipient — attempts/maxAttempts/
// nextAttemptAt/claimedAt/workerId back an isolated SKIP LOCKED claiming
// loop in smsCampaignWorker.service.js, deliberately separate from
// MessageQueue (WhatsApp's queue) so nothing here can affect it. Unique on
// (campaign_id, phone) enforces per-campaign dedup at the DB level.
module.exports = (sequelize, DataTypes) => {
  const SmsCampaignRecipient = sequelize.define('SmsCampaignRecipient', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    campaignId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    contactId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    leadId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    phone: { type: DataTypes.STRING(20), allowNull: false },
    recipientName: { type: DataTypes.STRING(200), allowNull: true },
    personalizedMessage: { type: DataTypes.TEXT, allowNull: true },
    matchedEntities: { type: DataTypes.JSONB, allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'pending' },
    provider: { type: DataTypes.STRING(40), allowNull: true },
    providerMessageId: { type: DataTypes.STRING(255), allowNull: true },
    smsMessageId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    errorMessage: { type: DataTypes.TEXT, allowNull: true },
    isPermanentFailure: { type: DataTypes.BOOLEAN, allowNull: true },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    maxAttempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 3 },
    nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
    claimedAt: { type: DataTypes.DATE, allowNull: true },
    workerId: { type: DataTypes.STRING(160), allowNull: true },
    queuedAt: { type: DataTypes.DATE, allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    failedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'sms_campaign_recipients',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['campaign_id'] },
      { fields: ['status'] },
      { fields: ['phone'] },
      { fields: ['campaign_id', 'status'] },
      { fields: ['sms_message_id'] },
      { fields: ['provider_message_id'] },
      { unique: true, fields: ['campaign_id', 'phone'] }
    ]
  });

  SmsCampaignRecipient.associate = (models) => {
    SmsCampaignRecipient.belongsTo(models.SmsCampaign, { foreignKey: 'campaign_id', as: 'campaign' });
    SmsCampaignRecipient.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    SmsCampaignRecipient.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    SmsCampaignRecipient.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
    SmsCampaignRecipient.belongsTo(models.SmsMessage, { foreignKey: 'sms_message_id', as: 'smsMessage' });
  };

  return SmsCampaignRecipient;
};
