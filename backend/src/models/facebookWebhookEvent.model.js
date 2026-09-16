module.exports = (sequelize, DataTypes) => {
  const FacebookWebhookEvent = sequelize.define('FacebookWebhookEvent', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    eventKey: { type: DataTypes.STRING(255), allowNull: false, unique: true, field: 'event_key' },
    eventType: { type: DataTypes.STRING(64), allowNull: false, field: 'event_type' },
    objectType: { type: DataTypes.STRING(32), allowNull: false, field: 'object_type' },
    facebookPageId: { type: DataTypes.BIGINT, allowNull: true, field: 'facebook_page_id' },
    payload: { type: DataTypes.JSONB, allowNull: false },
    receivedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'received_at' },
    processedAt: { type: DataTypes.DATE, allowNull: true, field: 'processed_at' },
    status: { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'received' },
    errorDetails: { type: DataTypes.TEXT, allowNull: true, field: 'error_details' }
  }, {
    tableName: 'facebook_webhook_events',
    timestamps: false,
    underscored: true,
    indexes: [
      { unique: true, fields: ['event_key'] },
      { fields: ['facebook_page_id'], name: 'facebook_webhook_events_page_idx' },
      { fields: ['status'], name: 'facebook_webhook_events_status_idx' }
    ]
  });

  FacebookWebhookEvent.associate = (models) => {
    FacebookWebhookEvent.belongsTo(models.FacebookPage, { foreignKey: 'facebook_page_id', as: 'facebookPage' });
  };

  return FacebookWebhookEvent;
};
