module.exports = (sequelize, DataTypes) => {
  const StudentDocument = sequelize.define('StudentDocument', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    fileName: { type: DataTypes.STRING(255), allowNull: false },
    fileUrl: { type: DataTypes.STRING(500), allowNull: false },
    type: { type: DataTypes.STRING(80), allowNull: true },
    uploadedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'student_documents',
    timestamps: true,
    updatedAt: false,
    underscored: true,
    indexes: [{ fields: ['student_id'] }, { fields: ['uploaded_by'] }, { fields: ['type'] }, { fields: ['created_at'] }]
  });

  StudentDocument.associate = (models) => {
    StudentDocument.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
    StudentDocument.belongsTo(models.User, { foreignKey: 'uploaded_by', as: 'uploader' });
  };

  return StudentDocument;
};
