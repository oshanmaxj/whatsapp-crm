module.exports = (sequelize, DataTypes) => {
  const Course = sequelize.define('Course', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING(160), allowNull: false },
    code: { type: DataTypes.STRING(40), allowNull: true, unique: true },
    category: { type: DataTypes.STRING(100), allowNull: true },
    description: { type: DataTypes.TEXT, allowNull: true },
    durationWeeks: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    feeAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: true },
    status: { type: DataTypes.ENUM('active', 'inactive', 'archived'), allowNull: false, defaultValue: 'active' }
  }, {
    tableName: 'courses',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [{ fields: ['status'] }, { fields: ['name'] }]
  });

  return Course;
};
