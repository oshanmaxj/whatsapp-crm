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
    code:{type:DataTypes.STRING(80),allowNull:true,unique:true},displayOrder:{type:DataTypes.INTEGER,allowNull:false,defaultValue:0},active:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:true},isClosed:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},isWon:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},isLost:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},color:{type:DataTypes.STRING(20),allowNull:true},category:{type:DataTypes.STRING(40),allowNull:false,defaultValue:'open'},reasonRequired:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},followupRequired:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},successfulContact:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},countsAsConversion:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},terminal:{type:DataTypes.BOOLEAN,allowNull:false,defaultValue:false},allowedNextStatusIds:{type:DataTypes.JSON,allowNull:false,defaultValue:[]}
  }, {
    tableName: 'lead_status',
    timestamps: true,
    paranoid: true,
    underscored: true
  });

  return LeadStatus;
};
