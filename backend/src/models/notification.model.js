module.exports = (sequelize, DataTypes) => {
  const Notification = sequelize.define('Notification', {
    id: { type: DataTypes.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
    type: { type: DataTypes.STRING(80), allowNull: false },
    title: { type: DataTypes.STRING(180), allowNull: false },
    message: { type: DataTypes.TEXT, allowNull: true },
    data: { type: DataTypes.JSON, allowNull: false, defaultValue: {} },
    readAt: { type: DataTypes.DATE, allowNull: true }
  }, {
    tableName: 'notifications',
    timestamps: true,
    underscored: true,
    indexes: [{ fields: ['user_id'] }, { fields: ['type'] }, { fields: ['read_at'] }]
  });

  Notification.associate = (models) => {
    Notification.belongsTo(models.User, { foreignKey: 'user_id', as: 'user' });
  };

  return Notification;
};
