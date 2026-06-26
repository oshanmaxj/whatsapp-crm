module.exports = (sequelize, DataTypes) => {
  const StudentNote = sequelize.define('StudentNote', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    note: { type: DataTypes.TEXT, allowNull: false },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'student_notes',
    timestamps: true,
    updatedAt: false,
    underscored: true,
    indexes: [{ fields: ['student_id'] }, { fields: ['created_by'] }, { fields: ['created_at'] }]
  });

  StudentNote.associate = (models) => {
    StudentNote.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
    StudentNote.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };

  return StudentNote;
};
