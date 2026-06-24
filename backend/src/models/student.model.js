module.exports = (sequelize, DataTypes) => {
  const Student = sequelize.define('Student', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentNo: { type: DataTypes.STRING(60), allowNull: false, unique: true },
    contactId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    leadId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    name: { type: DataTypes.STRING(180), allowNull: false },
    phone: { type: DataTypes.STRING(50), allowNull: false },
    email: { type: DataTypes.STRING(255), allowNull: true },
    status: { type: DataTypes.ENUM('enrolled', 'active', 'completed', 'dropped', 'suspended'), allowNull: false, defaultValue: 'enrolled' },
    enrolledAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
    notes: { type: DataTypes.TEXT, allowNull: true }
  }, {
    tableName: 'students',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [{ fields: ['contact_id'] }, { fields: ['lead_id'] }, { fields: ['course_id'] }, { fields: ['batch_id'] }, { fields: ['status'] }]
  });

  Student.associate = (models) => {
    Student.belongsTo(models.Contact, { foreignKey: 'contact_id', as: 'contact' });
    Student.belongsTo(models.Lead, { foreignKey: 'lead_id', as: 'lead' });
    Student.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
    Student.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
  };

  return Student;
};
