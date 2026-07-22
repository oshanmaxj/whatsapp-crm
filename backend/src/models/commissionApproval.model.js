module.exports = (sequelize, D) => sequelize.define('CommissionApproval', {
  id:{type:D.BIGINT,autoIncrement:true,primaryKey:true}, ledgerId:D.BIGINT, payoutId:D.BIGINT,
  approverUserId:{type:D.BIGINT,allowNull:false}, approverRole:D.STRING(100), action:{type:D.STRING(30),allowNull:false},
  comment:D.TEXT, beforeStatus:D.STRING(30), afterStatus:D.STRING(30), ipAddress:D.STRING(64), userAgent:D.TEXT
},{tableName:'commission_approvals',timestamps:true,updatedAt:false,underscored:true});
