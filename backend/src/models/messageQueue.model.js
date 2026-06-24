module.exports = (sequelize, DataTypes) => {
  const MessageQueue = sequelize.define('MessageQueue', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    channel: { type: DataTypes.ENUM('whatsapp', 'email', 'system'), allowNull: false, defaultValue: 'whatsapp' },
    messageType: { type: DataTypes.ENUM('text', 'image', 'document', 'audio', 'video', 'template'), allowNull: false, defaultValue: 'text' },
    status: { type: DataTypes.ENUM('queued', 'processing', 'sent', 'failed', 'retrying', 'cancelled'), allowNull: false, defaultValue: 'queued' },
    priority: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 5 },
    toNumber: { type: DataTypes.STRING(50), allowNull: false },
    payload: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    attempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    maxAttempts: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 3 },
    scheduledAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    processedAt: { type: DataTypes.DATE, allowNull: true },
    nextAttemptAt: { type: DataTypes.DATE, allowNull: true },
    lastError: { type: DataTypes.TEXT, allowNull: true },
    externalMessageId: { type: DataTypes.STRING(255), allowNull: true },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'message_queue',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['status'] },
      { fields: ['scheduled_at'] },
      { fields: ['priority'] },
      { fields: ['status', 'scheduled_at', 'priority'] },
      { fields: ['status', 'next_attempt_at'] }
    ]
  });

  MessageQueue.associate = (models) => {
    MessageQueue.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return MessageQueue;
};
