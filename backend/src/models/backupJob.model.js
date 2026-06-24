module.exports = (sequelize, DataTypes) => {
  const BackupJob = sequelize.define('BackupJob', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    type: { type: DataTypes.ENUM('export', 'restore', 'scheduled'), allowNull: false, defaultValue: 'export' },
    status: { type: DataTypes.ENUM('pending', 'completed', 'failed'), allowNull: false, defaultValue: 'pending' },
    filePath: { type: DataTypes.STRING(500), allowNull: true },
    metadata: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    errorMessage: { type: DataTypes.TEXT, allowNull: true },
    createdBy: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true }
  }, {
    tableName: 'backup_jobs',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['type'] }, { fields: ['status'] }]
  });

  return BackupJob;
};
