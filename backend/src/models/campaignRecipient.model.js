module.exports = (sequelize, DataTypes) => {
  const CampaignRecipient = sequelize.define('CampaignRecipient', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    campaignId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    whatsappAccountId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    contactId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    leadId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    phone: { type: DataTypes.STRING(50), allowNull: false },
    name: { type: DataTypes.STRING(200), allowNull: true },
    status: {
      type: DataTypes.ENUM('pending', 'queued', 'simulated_sent', 'sent', 'delivered', 'read', 'failed', 'unreachable', 'replied', 'converted'),
      allowNull: false,
      defaultValue: 'pending'
    },
    errorMessage: { type: DataTypes.STRING(255), allowNull: true },
    queueId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    externalMessageId: { type: DataTypes.STRING(255), allowNull: true },
    variableData: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    sentAt: { type: DataTypes.DATE, allowNull: true },
    deliveredAt: { type: DataTypes.DATE, allowNull: true },
    readAt: { type: DataTypes.DATE, allowNull: true },
    repliedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'campaign_recipients',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['campaign_id'] }, { fields: ['status'] }, { fields: ['phone'] }]
  });

  CampaignRecipient.associate = (models) => {
    CampaignRecipient.belongsTo(models.Campaign, { foreignKey: 'campaign_id', as: 'campaign' });
    CampaignRecipient.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    CampaignRecipient.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    CampaignRecipient.belongsTo(models.MessageQueue, { foreignKey: 'queue_id', as: 'queueItem' });
  };

  return CampaignRecipient;
};
