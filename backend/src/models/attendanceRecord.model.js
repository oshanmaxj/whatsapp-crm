module.exports = (sequelize, DataTypes) => {
  const AttendanceRecord = sequelize.define('AttendanceRecord', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    enrollmentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    lessonId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    attendanceDate: { type: DataTypes.DATEONLY, allowNull: false },
    status: { type: DataTypes.ENUM('present', 'absent', 'late', 'excused'), allowNull: false, defaultValue: 'present' },
    notes: { type: DataTypes.TEXT, allowNull: true },
    markedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    source: { type: DataTypes.STRING(40), allowNull: true },
    markedAt: { type: DataTypes.DATE, allowNull: true },
    joinedAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'attendance_records',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['student_id'] }, { fields: ['enrollment_id'] }, { fields: ['batch_id'] }, { fields: ['attendance_date'] }, { unique: true, fields: ['student_id', 'lesson_id'] }]
  });

  AttendanceRecord.associate = (models) => {
    AttendanceRecord.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
    AttendanceRecord.belongsTo(models.StudentEnrollment, { foreignKey: 'enrollment_id', as: 'enrollment' });
    AttendanceRecord.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
    AttendanceRecord.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
    AttendanceRecord.belongsTo(models.User, { foreignKey: 'marked_by', as: 'marker' });
    AttendanceRecord.belongsTo(models.LmsLesson, { foreignKey: 'lesson_id', as: 'lesson' });
  };

  return AttendanceRecord;
};
