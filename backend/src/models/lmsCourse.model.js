module.exports = (sequelize, DataTypes) => sequelize.define('LmsCourse', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  scopeKey: { type: DataTypes.STRING(100), allowNull: false },
  title: { type: DataTypes.STRING(255), allowNull: false },
  description: { type: DataTypes.TEXT, allowNull: true },
  instructorId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'published' },
  isPublished: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  updatedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
}, {
  tableName: 'lms_courses', timestamps: true, paranoid: true, underscored: true,
  indexes: [{ unique: true, fields: ['scope_key'] }, { fields: ['course_id', 'batch_id'] }]
});
