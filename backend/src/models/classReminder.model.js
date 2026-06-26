module.exports = (sequelize, DataTypes) => {
  const ClassReminder = sequelize.define('ClassReminder', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    scheduleDate: { type: DataTypes.DATEONLY, allowNull: false },
    reminderType: {
      type: DataTypes.ENUM('day_before', 'same_day_morning', 'one_hour_before', 'manual'),
      allowNull: false
    },
    scheduledTime: { type: DataTypes.DATE, allowNull: false },
    sentTime: { type: DataTypes.DATE, allowNull: true },
    status: { type: DataTypes.ENUM('pending', 'sent', 'failed', 'cancelled'), allowNull: false, defaultValue: 'pending' },
    channel: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'whatsapp' },
    message: { type: DataTypes.TEXT, allowNull: false },
    response: { type: DataTypes.JSON, allowNull: true }
  }, {
    tableName: 'class_reminders',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['batch_id'] },
      { fields: ['student_id'] },
      { fields: ['schedule_date'] },
      { fields: ['reminder_type'] },
      { fields: ['scheduled_time'] },
      { fields: ['status'] }
    ]
  });

  ClassReminder.associate = (models) => {
    ClassReminder.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
    ClassReminder.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
  };

  return ClassReminder;
};
