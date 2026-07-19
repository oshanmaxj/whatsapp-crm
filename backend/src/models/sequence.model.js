module.exports = (sequelize, DataTypes) => sequelize.define('Sequence', {
  id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
  name: { type: DataTypes.STRING(150), allowNull: false, unique: true },
  status: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'active' }
}, { tableName: 'sequences', timestamps: true, underscored: true });
