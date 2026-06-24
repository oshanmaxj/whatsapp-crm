module.exports = (sequelize, DataTypes) => {
  const MessageTemplate = sequelize.define('MessageTemplate', {
    id: { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    category: {
      type: DataTypes.ENUM('quick_reply', 'saved_reply', 'course_info', 'greeting'),
      allowNull: false,
      defaultValue: 'quick_reply'
    },
    body: { type: DataTypes.TEXT, allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'message_templates',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['category'] }, { fields: ['active'] }]
  });

  MessageTemplate.associate = (models) => {
    MessageTemplate.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return MessageTemplate;
};
