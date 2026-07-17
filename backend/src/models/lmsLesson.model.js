module.exports = (sequelize, DataTypes) => {
  const LmsLesson = sequelize.define('LmsLesson', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    topicId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    title: { type: DataTypes.STRING(255), allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: true },
    summary: { type: DataTypes.TEXT, allowNull: true },
    lessonType: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'video' },
    contentHtml: { type: DataTypes.TEXT, allowNull: true },
    externalUrl: { type: DataTypes.TEXT, allowNull: true },
    externalButtonLabel: { type: DataTypes.STRING(100), allowNull: true },
    openInNewTab: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    documentUrl: { type: DataTypes.TEXT, allowNull: true },
    documentPreviewEnabled: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    thumbnailUrl: { type: DataTypes.TEXT, allowNull: true },
    downloadAllowed: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'draft' },
    dripType: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'immediate' },
    dripValue: { type: DataTypes.INTEGER, allowNull: true },
    dripReleaseAt: { type: DataTypes.DATE, allowNull: true },
    lessonOrder: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    liveClassAt: { type: DataTypes.DATE, allowNull: true },
    zoomLink: { type: DataTypes.TEXT, allowNull: true },
    zoomMeetingId: { type: DataTypes.STRING(100), allowNull: true },
    zoomPassword: { type: DataTypes.STRING(100), allowNull: true },
    joinButtonLabel: { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Join Live Class' },
    allowJoinBeforeMinutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 30 },
    allowJoinAfterMinutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 150 },
    recordingUrl: { type: DataTypes.TEXT, allowNull: true },
    bunnyVideoId: { type: DataTypes.STRING(255), allowNull: true },
    bunnyEmbedUrl: { type: DataTypes.TEXT, allowNull: true },
    embedCode: { type: DataTypes.TEXT, allowNull: true },
    lecturerId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    isPublished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    releaseAt: { type: DataTypes.DATE, allowNull: true },
    durationMinutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    source: { type: DataTypes.STRING(50), allowNull: true },
    scheduleId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    scheduledLessonId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    scheduledStartAt: { type: DataTypes.DATE, allowNull: true },
    scheduledEndAt: { type: DataTypes.DATE, allowNull: true },
    publishedAt: { type: DataTypes.DATE, allowNull: true },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
    , updatedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, { tableName: 'lms_lessons', timestamps: true, paranoid: true, underscored: true });
  LmsLesson.associate = (models) => {
    LmsLesson.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
    LmsLesson.belongsTo(models.LmsTopic, { foreignKey: 'topic_id', as: 'topic' });
    LmsLesson.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
    LmsLesson.belongsTo(models.User, { foreignKey: 'lecturer_id', as: 'lecturer' });
    LmsLesson.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
    LmsLesson.belongsTo(models.CourseSchedule, { foreignKey: 'schedule_id', as: 'schedule' });
    LmsLesson.hasOne(models.ScheduledLesson, { foreignKey: 'lesson_id', as: 'scheduledLesson' });
    LmsLesson.hasMany(models.LmsLessonBatchOverride, { foreignKey: 'lesson_id', as: 'batchOverrides' });
  };
  return LmsLesson;
};
