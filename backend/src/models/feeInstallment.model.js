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
    pendingPaymentAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    confirmedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    confirmedAt: { type: DataTypes.DATE, allowNull: true },
    accountingTransactionId: { type: DataTypes.BIGINT, allowNull: true, unique: true },
    reversalAccountingTransactionId: { type: DataTypes.BIGINT, allowNull: true, unique: true },
    rejectedBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    rejectedAt: { type: DataTypes.DATE, allowNull: true },
    rejectionReason: { type: DataTypes.TEXT, allowNull: true },
    status: {
      type: DataTypes.ENUM(
        'pending', 'due_soon', 'due_today', 'paid', 'partially_paid', 'overdue',
        'pending_confirmation', 'confirmed', 'rejected', 'cancelled', 'reversed'
      ),
      allowNull: false,
      defaultValue: 'pending'
    },
    reminderSentAt: { type: DataTypes.DATE, allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true }
    , recordedByUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
    , creditedToUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
    , conversationOwnerUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
    , recordedAt: { type: DataTypes.DATE, allowNull: true }
    , attributionSource: { type: DataTypes.STRING(40), allowNull: true }
    , overrideReason: { type: DataTypes.TEXT, allowNull: true }
    , overriddenByUserId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'fee_installments',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['fee_id'] },
      { fields: ['status'] },
      { fields: ['due_date'] },
      { unique: true, fields: ['accounting_transaction_id'] },
      { unique: true, fields: ['reversal_accounting_transaction_id'] }
    ]
  });

  FeeInstallment.associate = (models) => {
    FeeInstallment.belongsTo(models.StudentFee, { foreignKey: { name: 'studentFeeId', field: 'fee_id' }, as: 'fee' });
    FeeInstallment.belongsTo(models.User, { foreignKey: { name: 'confirmedBy', field: 'confirmed_by' }, as: 'confirmer' });
    FeeInstallment.belongsTo(models.AccountingTransaction, { foreignKey: { name: 'accountingTransactionId', field: 'accounting_transaction_id' }, as: 'accountingTransaction' });
    FeeInstallment.belongsTo(models.AccountingTransaction, { foreignKey: { name: 'reversalAccountingTransactionId', field: 'reversal_accounting_transaction_id' }, as: 'reversalAccountingTransaction' });
  };

  return FeeInstallment;
};
