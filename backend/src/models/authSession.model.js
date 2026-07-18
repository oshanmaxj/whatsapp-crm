module.exports = (sequelize, DataTypes) => sequelize.define('AuthSession', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  tokenHash: { type: DataTypes.STRING(64), allowNull: false },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  lastUsedAt: { type: DataTypes.DATE, allowNull: true },
  revokedAt: { type: DataTypes.DATE, allowNull: true },
  ipAddress: { type: DataTypes.STRING(64), allowNull: true },
  userAgent: { type: DataTypes.STRING(500), allowNull: true }
}, {
  tableName: 'auth_sessions', timestamps: true, updatedAt: false, underscored: true,
  indexes: [{ fields: ['user_id', 'revoked_at'] }, { fields: ['expires_at'] }]
});
