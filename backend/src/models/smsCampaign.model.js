// Parallel to campaign.model.js (WhatsApp), deliberately not shared with it
// — see migration 069's comment for why. Provider-neutral: `provider`/`mode`
// are snapshots of whichever provider/mode was active at launch time, not
// SMSGo-specific fields.
module.exports = (sequelize, DataTypes) => {
  const SmsCampaign = sequelize.define('SmsCampaign', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(180), allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: false },
    senderMask: { type: DataTypes.STRING(40), allowNull: true },
    provider: { type: DataTypes.STRING(40), allowNull: true },
    mode: { type: DataTypes.STRING(10), allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft' },
    recipientSource: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'manual' },
    audienceConfig: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    totalRecipients: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    queuedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    sentCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    deliveredCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    failedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    rejectedCount: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    scheduledAt: { type: DataTypes.DATE, allowNull: true },
    startedAt: { type: DataTypes.DATE, allowNull: true },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    pausedAt: { type: DataTypes.DATE, allowNull: true },
    cancelledAt: { type: DataTypes.DATE, allowNull: true },
    lastError: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'sms_campaigns',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [
      { fields: ['status'] },
      { fields: ['scheduled_at'] },
      { fields: ['provider'] }
    ]
  });

  SmsCampaign.associate = (models) => {
    SmsCampaign.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    SmsCampaign.hasMany(models.SmsCampaignRecipient, { foreignKey: 'campaign_id', as: 'recipients' });
  };

  return SmsCampaign;
};
