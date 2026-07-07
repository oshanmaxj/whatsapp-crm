module.exports = (sequelize, DataTypes) => {
  const StudentEnrollment = sequelize.define('StudentEnrollment', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    enrollmentStatus: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'active',
      validate: { isIn: [['active', 'completed', 'suspended', 'cancelled', 'expired']] }
    },
    enrolledAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    completedAt: { type: DataTypes.DATE, allowNull: true },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'student_enrollments',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['student_id'] },
      { fields: ['course_id'] },
      { fields: ['batch_id'] },
      { fields: ['enrollment_status'] },
      { fields: ['student_id', 'course_id', 'batch_id'] },
      { fields: ['student_id', 'enrollment_status'] },
      { fields: ['course_id', 'batch_id'] }
    ]
  });

  StudentEnrollment.associate = (models) => {
    StudentEnrollment.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
    StudentEnrollment.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
    StudentEnrollment.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
    StudentEnrollment.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };
  return StudentEnrollment;
};
