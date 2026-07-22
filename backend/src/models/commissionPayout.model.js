module.exports = (sequelize, D) => sequelize.define('CommissionPayout', {
  id:{type:D.BIGINT,autoIncrement:true,primaryKey:true}, payoutNumber:{type:D.STRING(40),allowNull:false,unique:true},
  beneficiaryType:{type:D.STRING(30),allowNull:false}, beneficiaryId:{type:D.BIGINT,allowNull:false}, periodStart:D.DATEONLY, periodEnd:D.DATEONLY,
  grossEarnings:{type:D.DECIMAL(18,2),allowNull:false,defaultValue:0}, adjustments:{type:D.DECIMAL(18,2),allowNull:false,defaultValue:0},
  deductions:{type:D.DECIMAL(18,2),allowNull:false,defaultValue:0}, netPayable:{type:D.DECIMAL(18,2),allowNull:false,defaultValue:0},
  actualPaid:{type:D.DECIMAL(18,2),allowNull:false,defaultValue:0}, paymentMethod:D.STRING(40), bankReference:D.STRING(180),
  paidDate:D.DATEONLY, notes:D.TEXT, status:{type:D.STRING(30),allowNull:false,defaultValue:'draft'},
  accountingExpenseTransactionId:D.BIGINT, createdByUserId:{type:D.BIGINT,allowNull:false}, approvedByUserId:D.BIGINT,
  reconciledByUserId:D.BIGINT, reconciledAt:D.DATE
},{tableName:'commission_payouts',timestamps:true,underscored:true});
