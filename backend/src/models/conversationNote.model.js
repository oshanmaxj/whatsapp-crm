module.exports = (sequelize, DataTypes) => {
  const ConversationNote = sequelize.define('ConversationNote', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    conversationId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    type: {
      type: DataTypes.ENUM('private', 'agent', 'follow_up'),
      allowNull: false,
      defaultValue: 'private'
    },
    note: { type: DataTypes.TEXT, allowNull: false }
  }, {
    tableName: 'conversation_notes',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['conversation_id'] }, { fields: ['type'] }]
  });

  ConversationNote.associate = (models) => {
    ConversationNote.belongsTo(models.Conversation, { foreignKey: 'conversation_id', as: 'conversation' });
    ConversationNote.belongsTo(models.User, { foreignKey: 'created_by', as: 'author' });
  };

  return ConversationNote;
};
