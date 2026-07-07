module.exports = (sequelize, DataTypes) => {
  const LessonAutoPublishLog = sequelize.define('LessonAutoPublishLog', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  lessonId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  scheduledLessonId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  action: { type: DataTypes.STRING(80), allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: true }
  }, { tableName: 'lesson_auto_publish_logs', timestamps: true, underscored: true });
  LessonAutoPublishLog.associate = (models) => {
    LessonAutoPublishLog.belongsTo(models.LmsLesson, { foreignKey: 'lesson_id', as: 'lesson' });
    LessonAutoPublishLog.belongsTo(models.ScheduledLesson, { foreignKey: 'scheduled_lesson_id', as: 'scheduledLesson' });
  };
  return LessonAutoPublishLog;
};
