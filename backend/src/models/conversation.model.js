module.exports = (sequelize, DataTypes) => {
  const Conversation = sequelize.define('Conversation', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    contactId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: false
    },
    leadId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    whatsappThreadId: {
      type: DataTypes.STRING(255),
      allowNull: true,
      unique: true
    },
    assignedUserId: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    whatsappAccountId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    assignedRoleId: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true
    },
    status: {
      type: DataTypes.ENUM('open', 'closed', 'pending', 'archived'),
      allowNull: false,
      defaultValue: 'open'
    },
    summary: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    suggestedAgent: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    lastMessageAt: {
      type: DataTypes.DATE,
      allowNull: true
    },
    lastMessage: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'conversations',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [
      { fields: ['contact_id'] },
      { fields: ['lead_id'] },
      { fields: ['assigned_user_id'] },
      { fields: ['assigned_role_id'] },
      { fields: ['status'] },
      { fields: ['status', 'updated_at'] },
      { fields: ['last_message_at'] },
      { fields: ['updated_at'] }
    ]
  });

  Conversation.associate = (models) => {
    Conversation.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    Conversation.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    Conversation.belongsTo(models.User, { foreignKey: 'assigned_user_id', as: 'assignee' });
    Conversation.belongsTo(models.User, { foreignKey: 'assigned_user_id', as: 'assignedUser' });
    Conversation.belongsTo(models.Role, { foreignKey: 'assigned_role_id', as: 'assignedRole' });
  };

  return Conversation;
};
