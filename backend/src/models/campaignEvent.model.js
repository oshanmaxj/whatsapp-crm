module.exports = (sequelize, DataTypes) => {
  const CampaignEvent = sequelize.define('CampaignEvent', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    campaignId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    recipientId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    eventType: {
      type: DataTypes.ENUM('queued', 'simulated_sent', 'sent', 'delivered', 'read', 'failed', 'unreachable', 'replied', 'converted', 'cancelled'),
      allowNull: false
    },
    payload: { type: DataTypes.JSON, allowNull: true }
  }, {
    tableName: 'campaign_events',
    timestamps: true,
    updatedAt: false,
    underscored: true,
    indexes: [{ fields: ['campaign_id'] }, { fields: ['recipient_id'] }, { fields: ['event_type'] }]
  });

  CampaignEvent.associate = (models) => {
    CampaignEvent.belongsTo(models.Campaign, { foreignKey: 'campaign_id', as: 'campaign' });
    CampaignEvent.belongsTo(models.CampaignRecipient, { foreignKey: 'recipient_id', as: 'recipient' });
  };

  return CampaignEvent;
};
