module.exports = (sequelize, DataTypes) => {
  const CourseSchedule = sequelize.define('CourseSchedule', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    titlePrefix: { type: DataTypes.STRING(255), allowNull: false },
    startDate: { type: DataTypes.DATEONLY, allowNull: false },
    endDate: { type: DataTypes.DATEONLY, allowNull: false },
    classDays: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
    startTime: { type: DataTypes.TIME, allowNull: false },
    endTime: { type: DataTypes.TIME, allowNull: false },
    timezone: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Asia/Colombo' },
    instructorName: { type: DataTypes.STRING(180), allowNull: true },
    instructorId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    topicName: { type: DataTypes.STRING(255), allowNull: false, defaultValue: 'Live Classes' },
    meetingProvider: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'zoom' },
    zoomMeetingId: { type: DataTypes.STRING(120), allowNull: true },
    zoomJoinUrl: { type: DataTypes.TEXT, allowNull: true },
    zoomStartUrl: { type: DataTypes.TEXT, allowNull: true },
    zoomPassword: { type: DataTypes.STRING(120), allowNull: true },
    joinButtonLabel: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Join Live Class' },
    allowJoinBeforeMinutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 30 },
    allowJoinAfterMinutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 150 },
    autoCreateLessons: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    autoImportRecordings: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    reminderEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'active' },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, { tableName: 'course_schedules', timestamps: true, underscored: true });
  CourseSchedule.associate = (models) => {
    CourseSchedule.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
    CourseSchedule.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
    CourseSchedule.hasMany(models.ScheduledLesson, { foreignKey: 'schedule_id', as: 'scheduledLessons' });
  };
  return CourseSchedule;
};
