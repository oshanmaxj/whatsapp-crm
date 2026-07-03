module.exports = (sequelize, DataTypes) => {
  const Role = sequelize.define('Role', {
    id: {
      type: DataTypes.INTEGER.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false,
      unique: true
    },
    description: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    chatVisibilityScope: {
      type: DataTypes.STRING(30),
      allowNull: false,
      defaultValue: 'assigned_only',
      validate: {
        isIn: [['all', 'assigned_only', 'role_only', 'role_and_assigned']]
      }
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    receiveDepartmentAssignmentNotifications: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'roles',
    timestamps: true,
    paranoid: true,
    underscored: true
  });

  return Role;
};
