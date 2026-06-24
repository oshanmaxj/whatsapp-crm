module.exports = (sequelize, DataTypes) => {
  const AuditLog = sequelize.define('AuditLog', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    action: { type: DataTypes.STRING(120), allowNull: false },
    entityType: { type: DataTypes.STRING(80), allowNull: true },
    entityId: { type: DataTypes.STRING(80), allowNull: true },
    method: { type: DataTypes.STRING(12), allowNull: true },
    path: { type: DataTypes.STRING(500), allowNull: true },
    ipAddress: { type: DataTypes.STRING(80), allowNull: true },
    userAgent: { type: DataTypes.STRING(500), allowNull: true },
    changes: { type: DataTypes.JSON, allowNull: false, defaultValue: {} }
  }, {
    tableName: 'audit_logs',
    timestamps: true,
    updatedAt: false,
    underscored: true,
    indexes: [{ fields: ['user_id'] }, { fields: ['action'] }, { fields: ['entity_type'] }]
  });

  AuditLog.associate = (models) => {
    AuditLog.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  };

  return AuditLog;
};
