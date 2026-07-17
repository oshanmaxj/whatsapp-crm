module.exports = (sequelize, DataTypes) => sequelize.define('LmsTopic', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  lmsCourseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  title: { type: DataTypes.STRING(255), allowNull: false },
  normalizedTitle: { type: DataTypes.STRING(255), allowNull: true },
  summary: { type: DataTypes.TEXT, allowNull: true },
  sortOrder: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'published' },
  createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
  updatedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
}, {
  tableName: 'lms_topics', timestamps: true, paranoid: true, underscored: true,
  indexes: [{ fields: ['course_id'] }, { fields: ['course_id', 'sort_order'] }, { unique: true, fields: ['lms_course_id', 'normalized_title'] }]
});
