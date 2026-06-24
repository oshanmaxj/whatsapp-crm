module.exports = (sequelize, DataTypes) => {
  const LeadSource = sequelize.define('LeadSource', {
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
    tableName: 'lead_sources',
    timestamps: true,
    paranoid: true,
    underscored: true
  });

  return LeadSource;
};