module.exports = (sequelize, DataTypes) => {
  const Message = sequelize.define('Message', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    whatsappMessageId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true
    },
    conversationId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    contactId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    whatsappAccountId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    sentByUserId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    channel: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'whatsapp'
    },
    messageType: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    campaignId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    campaignRecipientId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    isInternalNotification: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    sentToUserId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    sentToPhone: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    direction: {
      type: DataTypes.ENUM('inbound', 'outbound'),
      allowNull: false
    },
    type: {
      type: DataTypes.ENUM('text', 'image', 'video', 'audio', 'document', 'template', 'location', 'sticker', 'reaction'),
      allowNull: false,
      defaultValue: 'text'
    },
    text: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    buttonPayload: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    interactiveType: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    mediaId: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    mediaUrl: {
      type: DataTypes.STRING(512),
      allowNull: true
    },
    replyToMessageId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    replyToWhatsappMessageId: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    templateName: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    fromNumber: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    toNumber: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    status: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'pending',
      validate: {
        isIn: [['pending', 'sent', 'delivered', 'read', 'failed']]
      }
    },
    statusUpdatedAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    isRead: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    readAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    rawPayload: {
      type: DataTypes.JSON,
      allowNull: true
    },
    sentiment: {
      type: DataTypes.ENUM('positive', 'neutral', 'negative'),
      allowNull: true
    },
    sentimentScore: {
      type: DataTypes.DECIMAL(5, 4),
      allowNull: true
    },
    errorCode: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    errorSubcode: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'messages',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [
      { fields: ['whatsapp_message_id'] },
      { fields: ['contact_id'] },
      { fields: ['conversation_id'] },
      { fields: ['sent_by_user_id'] },
      { fields: ['campaign_id'] },
      { fields: ['campaign_recipient_id'] },
      { fields: ['message_type'] },
      { fields: ['direction'] },
      { fields: ['status'] },
      { fields: ['reply_to_message_id'] },
      { fields: ['reply_to_whatsapp_message_id'] },
      { fields: ['conversation_id', 'created_at'] },
      { fields: ['conversation_id', 'is_read'] },
      { fields: ['created_at'] }
    ]
  });

  return Message;
};
