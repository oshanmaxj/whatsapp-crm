module.exports = (sequelize, DataTypes) => {
  const Batch = sequelize.define('Batch', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    courseId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
    name: { type: DataTypes.STRING(160), allowNull: false },
    code: { type: DataTypes.STRING(60), allowNull: true, unique: true },
    startDate: { type: DataTypes.DATEONLY, allowNull: true },
    endDate: { type: DataTypes.DATEONLY, allowNull: true },
    schedule: { type: DataTypes.STRING(255), allowNull: true },
    capacity: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
    whatsappGroupLink: { type: DataTypes.STRING(500), allowNull: true },
    whatsappGroupName: { type: DataTypes.STRING(180), allowNull: true },
    assignedTrainerId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    status: { type: DataTypes.ENUM('upcoming', 'active', 'completed', 'cancelled'), allowNull: false, defaultValue: 'upcoming' }
  }, {
    tableName: 'batches',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [{ fields: ['course_id'] }, { fields: ['status'] }]
  });

  Batch.associate = (models) => {
    Batch.belongsTo(models.Course, { foreignKey: 'course_id', as: 'course' });
    Batch.belongsTo(models.User, { foreignKey: 'assigned_trainer_id', as: 'trainer' });
  };

  return Batch;
};
