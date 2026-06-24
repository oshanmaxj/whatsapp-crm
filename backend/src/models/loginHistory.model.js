module.exports = (sequelize, DataTypes) => {
  const LoginHistory = sequelize.define('LoginHistory', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    email: { type: DataTypes.STRING(255), allowNull: true },
    status: { type: DataTypes.ENUM('success', 'failed'), allowNull: false },
    ipAddress: { type: DataTypes.STRING(80), allowNull: true },
    userAgent: { type: DataTypes.STRING(500), allowNull: true },
    reason: { type: DataTypes.STRING(255), allowNull: true }
  }, {
    tableName: 'login_history',
    timestamps: true,
    updatedAt: false,
    underscored: true,
    indexes: [{ fields: ['user_id'] }, { fields: ['email'] }, { fields: ['status'] }]
  });

  return LoginHistory;
};
