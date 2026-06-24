module.exports = (sequelize, DataTypes) => {
  const UserRole = sequelize.define('UserRole', {
    userId: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      allowNull: false
    },
    roleId: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      allowNull: false
    }
  }, {
    tableName: 'user_roles',
    timestamps: true,
    createdAt: 'assigned_at',
    updatedAt: false,
    underscored: true,
    indexes: [{ fields: ['user_id'] }, { fields: ['role_id'] }]
  });

  return UserRole;
};
