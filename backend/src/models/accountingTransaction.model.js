module.exports = (sequelize, DataTypes) => {
  const AccountingTransaction = sequelize.define('AccountingTransaction', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    type: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [['income', 'expense']] } },
    date: { type: DataTypes.DATEONLY, allowNull: false },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, validate: { min: 0.01 } },
    categoryId: { type: DataTypes.BIGINT, allowNull: false, field: 'category_id' },
    paymentMethod: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'cash', field: 'payment_method', validate: { isIn: [['cash', 'bank', 'card', 'online', 'other']] } },
    referenceNo: { type: DataTypes.STRING(120), allowNull: true, field: 'reference_no' },
    description: { type: DataTypes.TEXT, allowNull: true },
    relatedStudentId: { type: DataTypes.BIGINT, allowNull: true, field: 'related_student_id' },
    relatedCourseId: { type: DataTypes.BIGINT, allowNull: true, field: 'related_course_id' },
    relatedCampaignId: { type: DataTypes.BIGINT, allowNull: true, field: 'related_campaign_id' },
    createdBy: { type: DataTypes.BIGINT, allowNull: true, field: 'created_by' }
  }, {
    tableName: 'accounting_transactions',
    timestamps: true,
    underscored: true,
    indexes: [
      { fields: ['type', 'date'], name: 'accounting_transactions_type_date_idx' },
      { fields: ['category_id'], name: 'accounting_transactions_category_id_idx' },
      { fields: ['payment_method'], name: 'accounting_transactions_payment_method_idx' }
    ]
  });
  AccountingTransaction.associate = (models) => {
    AccountingTransaction.belongsTo(models.AccountingCategory, { foreignKey: 'category_id', as: 'category' });
    AccountingTransaction.belongsTo(models.Student, { foreignKey: 'related_student_id', as: 'student' });
    AccountingTransaction.belongsTo(models.Course, { foreignKey: 'related_course_id', as: 'course' });
    AccountingTransaction.belongsTo(models.Campaign, { foreignKey: 'related_campaign_id', as: 'campaign' });
    AccountingTransaction.belongsTo(models.User, { foreignKey: 'created_by', as: 'creator' });
  };
  return AccountingTransaction;
};
