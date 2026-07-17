module.exports = (sequelize, DataTypes) => {
  const LmsStudentProgress = sequelize.define('LmsStudentProgress', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    lessonId: { type: DataTypes.BIGINT, allowNull: false },
    courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    topicId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'not_started' },
    startedAt: { type: DataTypes.DATE, allowNull: true },
    openedAt: { type: DataTypes.DATE, allowNull: true },
    lastWatchedSeconds: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
    watchedPercentage: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0 },
    isCompleted: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    completedAt: { type: DataTypes.DATE, allowNull: true }
  }, { tableName: 'lms_student_progress', timestamps: true, underscored: true });
  return LmsStudentProgress;
};
