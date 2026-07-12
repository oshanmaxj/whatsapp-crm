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
    },
    code:{type:DataTypes.STRING(80),allowNull:true,unique:true},displayOrder:{type:DataTypes.INTEGER,allowNull:false,defaultValue:0},active:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:true},isClosed:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},isWon:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},isLost:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},color:{type:DataTypes.STRING(20),allowNull:true}
  }, {
    tableName: 'lead_status',
    timestamps: true,
    paranoid: true,
    underscored: true
  });

  return LeadStatus;
};
