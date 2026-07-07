module.exports = (sequelize, DataTypes) => {
  const LmsLiveClassJoin = sequelize.define('LmsLiveClassJoin', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    lessonId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    joinedAt: { type: DataTypes.DATE, allowNull: true },
    ipAddress: { type: DataTypes.STRING(64), allowNull: true },
    userAgent: { type: DataTypes.TEXT, allowNull: true },
    accessStatus: { type: DataTypes.STRING(20), allowNull: false },
    blockedReason: { type: DataTypes.STRING(120), allowNull: true }
  }, { tableName: 'lms_live_class_joins', timestamps: true, underscored: true });
  return LmsLiveClassJoin;
};
