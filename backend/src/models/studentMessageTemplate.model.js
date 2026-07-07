module.exports = (sequelize, DataTypes) => {
  const StudentMessageTemplate = sequelize.define('StudentMessageTemplate', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING(180), allowNull: false },
    key: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    category: { type: DataTypes.STRING(40), allowNull: false },
    channel: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'whatsapp' },
    body: { type: DataTypes.TEXT, allowNull: false },
    buttons: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    automationEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  }, { tableName: 'student_message_templates', timestamps: true, underscored: true });
  return StudentMessageTemplate;
};
