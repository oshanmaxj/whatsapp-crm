module.exports = (sequelize, DataTypes) => {
  const LmsLessonMaterial = sequelize.define('LmsLessonMaterial', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    lessonId: { type: DataTypes.BIGINT, allowNull: false },
    courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    title: { type: DataTypes.STRING(255), allowNull: false },
    fileUrl: { type: DataTypes.TEXT, allowNull: false },
    fileType: { type: DataTypes.STRING(100), allowNull: true },
    materialType: { type: DataTypes.STRING(40), allowNull: false, defaultValue: 'External Link' },
    description: { type: DataTypes.TEXT, allowNull: true },
    visibility: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'all_students' },
    status: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'published' }
  }, { tableName: 'lms_lesson_materials', timestamps: true, updatedAt: false, underscored: true });
  LmsLessonMaterial.associate = (models) => {
    LmsLessonMaterial.belongsTo(models.LmsLesson, { foreignKey: 'lesson_id', as: 'lesson' });
    LmsLessonMaterial.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
    LmsLessonMaterial.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
  };
  return LmsLessonMaterial;
};
