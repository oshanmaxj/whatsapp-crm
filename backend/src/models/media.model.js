module.exports = (sequelize, DataTypes) => {
  const Media = sequelize.define('Media', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    conversationId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    messageId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    uploadedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    fileName: { type: DataTypes.STRING(255), allowNull: false },
    originalName: { type: DataTypes.STRING(255), allowNull: true },
    mimeType: { type: DataTypes.STRING(150), allowNull: false },
    mediaType: { type: DataTypes.ENUM('image', 'pdf', 'document', 'audio', 'voice', 'video'), allowNull: false },
    size: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    storagePath: { type: DataTypes.STRING(512), allowNull: false },
    publicUrl: { type: DataTypes.STRING(512), allowNull: true },
    caption: { type: DataTypes.TEXT, allowNull: true }
  }, {
    tableName: 'media',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['conversation_id'] },
      { fields: ['message_id'] },
      { fields: ['media_type'] }
    ]
  });

  Media.associate = (models) => {
    Media.belongsTo(models.Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
    Media.belongsTo(models.Message, { foreignKey: 'message_id', as: 'message' });
    Media.belongsTo(models.User, { foreignKey: 'uploaded_by', as: 'uploader' });
  };

  return Media;
};
