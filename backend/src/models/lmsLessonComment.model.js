module.exports = (sequelize, DataTypes) => {
  const LmsLessonComment = sequelize.define('LmsLessonComment', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    lessonId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    comment: { type: DataTypes.TEXT, allowNull: false }
  }, {
    tableName: 'lms_lesson_comments',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['lesson_id', 'created_at'] }]
  });
  LmsLessonComment.associate = (models) => {
    LmsLessonComment.belongsTo(models.LmsLesson, { foreignKey: 'lesson_id', as: 'lesson' });
    LmsLessonComment.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
  };
  return LmsLessonComment;
};
