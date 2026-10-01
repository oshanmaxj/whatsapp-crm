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
    facebookPageId: { type: DataTypes.BIGINT, allowNull: true, field: 'facebook_page_id' },
    facebookMessageId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true,
      field: 'facebook_message_id'
    },
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
    // 72-hour Free Entry Point referral evidence (present only on an
    // inbound message that genuinely arrived via a Click-to-WhatsApp ad or
    // a Facebook/Instagram Page "Message" CTA — see messagingWindow.service.js).
    referralSourceType: { type: DataTypes.STRING(50), allowNull: true, field: 'referral_source_type' },
    referralSourceId: { type: DataTypes.STRING(255), allowNull: true, field: 'referral_source_id' },
    referralSourceUrl: { type: DataTypes.STRING(1024), allowNull: true, field: 'referral_source_url' },
    referralHeadline: { type: DataTypes.TEXT, allowNull: true, field: 'referral_headline' },
    ctwaClid: { type: DataTypes.STRING(255), allowNull: true, field: 'ctwa_clid' },
    // Meta status-webhook pricing/billing metadata (see whatsappCompliance.service.js's
    // billing classification). NULL means unknown/unverified, never "free".
    pricingCategory: { type: DataTypes.STRING(50), allowNull: true, field: 'pricing_category' },
    pricingModel: { type: DataTypes.STRING(20), allowNull: true, field: 'pricing_model' },
    pricingBillable: { type: DataTypes.BOOLEAN, allowNull: true, field: 'pricing_billable' },
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
      { fields: ['facebook_message_id'] },
      { fields: ['facebook_page_id'], name: 'messages_facebook_page_idx' },
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
      { fields: ['created_at'] },
      { fields: ['conversation_id', 'referral_source_type', 'created_at'], name: 'messages_conversation_referral_idx' }
    ]
  });

  return Message;
};
