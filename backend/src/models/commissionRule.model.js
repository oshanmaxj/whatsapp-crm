module.exports = (sequelize, D) => sequelize.define('CommissionRule', {
  id:{type:D.BIGINT.UNSIGNED,autoIncrement:true,primaryKey:true}, name:{type:D.STRING(180),allowNull:false}, scopeType:{type:D.STRING(40),allowNull:false}, scopeId:D.BIGINT,
  agentUserId:{type:D.BIGINT.UNSIGNED,allowNull:true}, departmentId:{type:D.INTEGER.UNSIGNED,allowNull:true}, courseId:{type:D.BIGINT.UNSIGNED,allowNull:true},
  earningType:{type:D.STRING(40),allowNull:false,defaultValue:'agent_commission'}, beneficiaryType:D.STRING(30), beneficiaryId:D.BIGINT,
  commissionType:{type:D.STRING(30),allowNull:false}, calculationType:{type:D.STRING(50),allowNull:false,defaultValue:'percentage_collected'},
  percentageRate:{type:D.DECIMAL(9,4),allowNull:true}, fixedAmount:{type:D.DECIMAL(18,2),allowNull:true}, minimumPaymentAmount:{type:D.DECIMAL(18,2),allowNull:true},
  maximumCommissionAmount:{type:D.DECIMAL(18,2),allowNull:true}, tierConfiguration:D.JSONB, priority:{type:D.INTEGER,allowNull:false,defaultValue:0},
  stackable:{type:D.BOOLEAN,allowNull:false,defaultValue:false}, exclusive:{type:D.BOOLEAN,allowNull:false,defaultValue:true},
  effectiveFrom:{type:D.DATEONLY,allowNull:false}, effectiveTo:{type:D.DATEONLY,allowNull:true}, approvalRequired:{type:D.BOOLEAN,allowNull:false,defaultValue:true},
  payoutDelayDays:{type:D.INTEGER,allowNull:false,defaultValue:0}, status:{type:D.STRING(20),allowNull:false,defaultValue:'active'},
  active:{type:D.BOOLEAN,allowNull:false,defaultValue:true}, createdByUserId:{type:D.BIGINT.UNSIGNED,allowNull:true}, updatedByUserId:D.BIGINT, deletedAt:D.DATE
},{tableName:'commission_rules',timestamps:true,paranoid:true,underscored:true});
