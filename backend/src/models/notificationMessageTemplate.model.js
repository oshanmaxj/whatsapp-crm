module.exports = (sequelize, DataTypes) => {
  const NotificationMessageTemplate = sequelize.define('NotificationMessageTemplate', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    key: { type: DataTypes.STRING(100), allowNull: false, unique: true },
    title: { type: DataTypes.STRING(180), allowNull: false },
    channel: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'whatsapp',
      validate: { isIn: [['whatsapp', 'email', 'sms']] }
    },
    body: { type: DataTypes.TEXT, allowNull: false },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  }, {
    tableName: 'notification_message_templates',
    timestamps: true,
    underscored: true,
    indexes: [{ unique: true, fields: ['key'] }, { fields: ['channel', 'is_active'] }]
  });

  return NotificationMessageTemplate;
};
