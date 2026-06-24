module.exports = (sequelize, DataTypes) => {
  const AutoReply = sequelize.define('AutoReply', {
    id: {
      type: DataTypes.BIGINT.UNSIGNED,
      autoIncrement: true,
      primaryKey: true
    },
    trigger: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true
    },
    matchType: {
      type: DataTypes.ENUM('exact', 'contains', 'regex'),
      allowNull: false,
      defaultValue: 'contains'
    },
    response: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    active: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    },
    createdBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    updatedBy: {
      type: DataTypes.BIGINT.UNSIGNED,
      allowNull: true
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'auto_replies',
    timestamps: true,
    paranoid: true,
    underscored: true,
    indexes: [
      { fields: ['trigger'] },
      { fields: ['active'] }
    ]
  });

  return AutoReply;
};