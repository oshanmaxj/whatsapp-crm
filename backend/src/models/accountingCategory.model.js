module.exports = (sequelize, DataTypes) => {
  const AccountingCategory = sequelize.define('AccountingCategory', {
    id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(150), allowNull: false },
    type: { type: DataTypes.STRING(20), allowNull: false, validate: { isIn: [['income', 'expense']] } },
    description: { type: DataTypes.TEXT, allowNull: true },
    isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  }, {
    tableName: 'accounting_categories',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['type', 'is_active'], name: 'accounting_categories_type_active_idx' }]
  });
  AccountingCategory.associate = (models) => {
    AccountingCategory.hasMany(models.AccountingTransaction, { foreignKey: 'category_id', as: 'transactions' });
  };
  return AccountingCategory;
};
