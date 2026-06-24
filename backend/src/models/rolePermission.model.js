module.exports = (sequelize, DataTypes) => {
  const RolePermission = sequelize.define('RolePermission', {
    roleId: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      allowNull: false
    },
    permissionId: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      allowNull: false
    }
  }, {
    tableName: 'role_permissions',
    timestamps: true,
    createdAt: 'granted_at',
    updatedAt: false,
    underscored: true,
    indexes: [{ fields: ['role_id'] }, { fields: ['permission_id'] }]
  });

  return RolePermission;
};
