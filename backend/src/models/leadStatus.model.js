module.exports = (sequelize, DataTypes) => {
  const LeadStatus = sequelize.define('LeadStatus', {
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
    }
  }, {
    tableName: 'lead_status',
    timestamps: true,
    paranoid: true,
    underscored: true
  });

  return LeadStatus;
};