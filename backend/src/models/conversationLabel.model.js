module.exports = (sequelize, DataTypes) => {
  const ConversationLabel = sequelize.define('ConversationLabel', {
    conversationId: { type: DataTypes.BIGINT.UNSIGNED, primaryKey: true, allowNull: false },
    labelId: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, allowNull: false }
  }, {
    tableName: 'conversation_labels',
    timestamps: true,
    createdAt: 'assigned_at',
    updatedAt: false,
    underscored: true
  });

  return ConversationLabel;
};
