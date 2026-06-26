module.exports = (sequelize, DataTypes) => {
  const FeeInstallment = sequelize.define('FeeInstallment', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentFeeId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, field: 'fee_id' },
    installmentNo: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    paidAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    dueDate: { type: DataTypes.DATEONLY, allowNull: false },
    paidDate: { type: DataTypes.DATEONLY, allowNull: true },
    paymentMethod: {
      type: DataTypes.ENUM('Cash', 'Bank Deposit', 'Bank Transfer', 'Card', 'Online Payment', 'Cheque', 'Free Card', 'Scholarship', 'Other'),
      allowNull: true
    },
    transactionReference: { type: DataTypes.STRING(180), allowNull: true },
    status: {
      type: DataTypes.ENUM('pending', 'due_soon', 'due_today', 'paid', 'partially_paid', 'overdue', 'cancelled'),
      allowNull: false,
      defaultValue: 'pending'
    },
    reminderSentAt: { type: DataTypes.DATE, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true }
  }, {
    tableName: 'fee_installments',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['fee_id'] }, { fields: ['status'] }, { fields: ['due_date'] }]
  });

  FeeInstallment.associate = (models) => {
    FeeInstallment.belongsTo(models.StudentFee, { foreignKey: { name: 'studentFeeId', field: 'fee_id' }, as: 'fee' });
  };

  return FeeInstallment;
};