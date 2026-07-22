module.exports = (sequelize, D) => sequelize.define('CommissionCalculationSnapshot', {
  id:{type:D.BIGINT,autoIncrement:true,primaryKey:true}, ledgerId:{type:D.BIGINT,allowNull:false,unique:true},
  studentName:D.STRING(200), registrationNumber:D.STRING(100), courseName:D.STRING(200), batchName:D.STRING(200),
  paymentReference:D.STRING(180), paymentMethod:D.STRING(60), beneficiaryName:D.STRING(200), ruleName:D.STRING(180),
  ruleVersion:D.JSONB, calculation:{type:D.JSONB,allowNull:false}
},{tableName:'commission_calculation_snapshots',timestamps:true,updatedAt:false,underscored:true});
