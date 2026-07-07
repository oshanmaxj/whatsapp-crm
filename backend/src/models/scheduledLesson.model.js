module.exports = (sequelize, DataTypes) => {
  const ScheduledLesson = sequelize.define('ScheduledLesson', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    scheduleId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    lessonId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    lessonNumber: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
    title: { type: DataTypes.STRING(255), allowNull: false },
    scheduledStartAt: { type: DataTypes.DATE, allowNull: false },
    scheduledEndAt: { type: DataTypes.DATE, allowNull: false },
    timezone: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Asia/Colombo' },
    zoomMeetingId: { type: DataTypes.STRING(120), allowNull: true },
    zoomJoinUrl: { type: DataTypes.TEXT, allowNull: true },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'scheduled' },
    recordingImportStatus: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'pending' }
  }, { tableName: 'scheduled_lessons', timestamps: true, underscored: true });
  ScheduledLesson.associate = (models) => {
    ScheduledLesson.belongsTo(models.CourseSchedule, { foreignKey: 'schedule_id', as: 'schedule' });
    ScheduledLesson.belongsTo(models.LmsLesson, { foreignKey: 'lesson_id', as: 'lesson' });
    ScheduledLesson.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
    ScheduledLesson.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
  };
  return ScheduledLesson;
};
