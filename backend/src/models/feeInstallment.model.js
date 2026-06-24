module.exports = (sequelize, DataTypes) => {
  const FeeInstallment = sequelize.define('FeeInstallment', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    feeId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    installmentNo: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 1 },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    paidAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0 },
    dueDate: { type: DataTypes.DATEONLY, allowNull: false },
    paidAt: { type: DataTypes.DATE, allowNull: true },
    status: { type: DataTypes.ENUM('pending', 'partial', 'paid', 'overdue'), allowNull: false, defaultValue: 'pending' },
    reminderSentAt: { type: DataTypes.DATE, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true }
  }, {
    tableName: 'fee_installments',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['fee_id'] }, { fields: ['status'] }, { fields: ['due_date'] }]
  });

  FeeInstallment.associate = (models) => {
    FeeInstallment.belongsTo(models.StudentFee, { foreignKey: 'fee_id', as: 'fee' });
  };

  return FeeInstallment;
};
