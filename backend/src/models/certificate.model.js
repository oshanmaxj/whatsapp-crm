module.exports = (sequelize, DataTypes) => {
  const Certificate = sequelize.define('Certificate', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    certificateNo: { type: DataTypes.STRING(80), allowNull: false, unique: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    issuedAt: { type: DataTypes.DATEONLY, allowNull: true },
    status: { type: DataTypes.ENUM('draft', 'issued', 'revoked'), allowNull: false, defaultValue: 'draft' },
    certificateUrl: { type: DataTypes.STRING(500), allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    issuedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'certificates',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [{ fields: ['student_id'] }, { fields: ['status'] }]
  });

  Certificate.associate = (models) => {
    Certificate.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
    Certificate.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
    Certificate.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
    Certificate.belongsTo(models.User, { foreignKey: 'issued_by', as: 'issuer' });
  };

  return Certificate;
};
