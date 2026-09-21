// Provider-neutral by design: `provider` names whichever adapter under
// services/sms/providers/ handled this message; `providerMessageId` and
// `providerStatus` are that provider's own identifiers; `providerMetadata`
// holds whatever raw, provider-specific response shape needs preserving
// (e.g. SMSGo's sandbox/live mode) without giving it a first-class column.
module.exports = (sequelize, DataTypes) => {
  const SmsMessage = sequelize.define('SmsMessage', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    toNumber: { type: DataTypes.STRING(20), allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
    mask: { type: DataTypes.STRING(40), allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'queued' },
    provider: { type: DataTypes.STRING(40), allowNull: true },
    providerMessageId: { type: DataTypes.STRING(255), allowNull: true },
    providerStatus: { type: DataTypes.STRING(60), allowNull: true },
    providerMetadata: { type: DataTypes.JSONB, allowNull: true },
    campaignName: { type: DataTypes.STRING(180), allowNull: true },
    errorMessage: { type: DataTypes.TEXT, allowNull: true },
    segments: { type: DataTypes.INTEGER, allowNull: true },
    cost: { type: DataTypes.DECIMAL(10, 4), allowNull: true },
    source: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'manual' },
    // Set only for automatic student-notification sends (welcome/class
    // reminder/birthday/payment reminder) — the send claims this key before
    // calling the provider, so a duplicate automatic dispatch (e.g. after a
    // worker restart) hits the unique index instead of re-sending. NULL for
    // manual/campaign sends, which keep their existing unlimited-resend
    // behavior (Postgres unique indexes treat NULLs as distinct).
    dedupeKey: { type: DataTypes.STRING(150), allowNull: true },
    contactId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    leadId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    failedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'sms_messages',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['status'] },
      { fields: ['provider'] },
      { fields: ['provider_message_id'] },
      { fields: ['to_number'] },
      { fields: ['created_at'] },
      { fields: ['dedupe_key'], unique: true }
    ]
  });

  SmsMessage.associate = (models) => {
    SmsMessage.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    SmsMessage.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    SmsMessage.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
    SmsMessage.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return SmsMessage;
};
