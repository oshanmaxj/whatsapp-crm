module.exports = (sequelize, DataTypes) => sequelize.define('LmsLessonBatchOverride', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  lessonId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  liveClassAt: { type: DataTypes.DATE, allowNull: true },
  zoomLink: { type: DataTypes.TEXT, allowNull: true },
  zoomMeetingId: { type: DataTypes.STRING(120), allowNull: true },
  zoomPassword: { type: DataTypes.TEXT, allowNull: true },
  dripReleaseAt: { type: DataTypes.DATE, allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'published' }
}, {
  tableName: 'lms_lesson_batch_overrides', timestamps: true, underscored: true,
  indexes: [{ unique: true, fields: ['lesson_id', 'batch_id'] }, { fields: ['batch_id'] }]
});
