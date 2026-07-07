module.exports = (sequelize, DataTypes) => sequelize.define('StudentPortalSession', {
  id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
  studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
  tokenHash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
  otpHash: { type: DataTypes.STRING(255), allowNull: true },
  otpExpiresAt: { type: DataTypes.DATE, allowNull: true },
  verifiedAt: { type: DataTypes.DATE, allowNull: true },
  expiresAt: { type: DataTypes.DATE, allowNull: false },
  revokedAt: { type: DataTypes.DATE, allowNull: true }
}, { tableName: 'student_portal_sessions', timestamps: true, underscored: true });
