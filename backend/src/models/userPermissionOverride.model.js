module.exports = (sequelize, DataTypes) => {
  const UserPermissionOverride = sequelize.define('UserPermissionOverride', {
    userId: {
      type: DataTypes.BIGINT.UNSIGNED,
      primaryKey: true,
      allowNull: false
    },
    permissionId: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      allowNull: false
    },
    effect: {
      type: DataTypes.ENUM('allow', 'deny'),
      allowNull: false
    }
  }, {
    tableName: 'user_permission_overrides',
    timestamps: true,
    underscored: true,
    indexes: [
      { unique: true, fields: ['user_id', 'permission_id'] },
      { fields: ['user_id'] },
      { fields: ['permission_id'] }
    ]
  });

  return UserPermissionOverride;
};
