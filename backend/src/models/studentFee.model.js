module.exports = (sequelize, DataTypes) => {
  const StudentFee = sequelize.define('StudentFee', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    batchId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    paymentType: { type: DataTypes.ENUM('full', 'installment'), allowNull: false, defaultValue: 'full' },
    totalAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    paidAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    discountAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    status: { type: DataTypes.ENUM('pending', 'partial', 'paid', 'overdue', 'cancelled'), allowNull: false, defaultValue: 'pending' },
    dueDate: { type: DataTypes.DATEONLY, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true }
  }, {
    tableName: 'student_fees',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [{ fields: ['student_id'] }, { fields: ['status'] }, { fields: ['due_date'] }]
  });

  StudentFee.associate = (models) => {
    StudentFee.belongsTo(models.Student, { foreignKey: 'student_id', as: 'student' });
    StudentFee.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
    StudentFee.belongsTo(models.Batch, { foreignKey: 'batch_id', as: 'batch' });
  };

  return StudentFee;
};
