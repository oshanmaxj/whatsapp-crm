module.exports = (sequelize, DataTypes) => {
  const ZoomRecordingImport = sequelize.define('ZoomRecordingImport', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  scheduledLessonId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  lessonId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  zoomMeetingId: { type: DataTypes.STRING(120), allowNull: false },
  zoomUuid: { type: DataTypes.STRING(255), allowNull: true },
  topic: { type: DataTypes.STRING(255), allowNull: true },
  startTime: { type: DataTypes.DATE, allowNull: true },
  durationMinutes: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
  recordingFileId: { type: DataTypes.STRING(255), allowNull: true },
  recordingType: { type: DataTypes.STRING(80), allowNull: true },
  downloadUrl: { type: DataTypes.TEXT, allowNull: true },
  playUrl: { type: DataTypes.TEXT, allowNull: true },
  fileSize: { type: DataTypes.BIGINT, allowNull: true },
  status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'found' },
  storageProvider: { type: DataTypes.STRING(30), allowNull: true },
  storageUrl: { type: DataTypes.TEXT, allowNull: true },
  embedCode: { type: DataTypes.TEXT, allowNull: true },
  errorMessage: { type: DataTypes.TEXT, allowNull: true }
  }, { tableName: 'zoom_recording_imports', timestamps: true, underscored: true });
  ZoomRecordingImport.associate = (models) => {
    ZoomRecordingImport.belongsTo(models.ScheduledLesson, { foreignKey: 'scheduled_lesson_id', as: 'scheduledLesson' });
    ZoomRecordingImport.belongsTo(models.LmsLesson, { foreignKey: 'lesson_id', as: 'lesson' });
  };
  return ZoomRecordingImport;
};
