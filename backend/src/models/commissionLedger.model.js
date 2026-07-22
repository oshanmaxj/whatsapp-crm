module.exports = (sequelize, D) => sequelize.define('CommissionLedger', {
  id:{type:D.BIGINT,autoIncrement:true,primaryKey:true}, sourcePaymentId:{type:D.BIGINT,allowNull:false},
  sourceAccountingTransactionId:D.BIGINT, earningType:{type:D.STRING(40),allowNull:false}, earningComponent:{type:D.STRING(60),allowNull:false},
  beneficiaryType:{type:D.STRING(30),allowNull:false}, beneficiaryId:{type:D.BIGINT,allowNull:false}, ruleId:D.BIGINT,
  lecturerAgreementId:D.BIGINT, studentId:D.BIGINT, enrollmentId:D.BIGINT, courseId:D.BIGINT, batchId:D.BIGINT, leadId:D.BIGINT,
  whatsappAccountId:D.BIGINT, grossPayment:{type:D.DECIMAL(18,2),allowNull:false}, discountAmount:{type:D.DECIMAL(18,2),defaultValue:0},
  refundAmount:{type:D.DECIMAL(18,2),defaultValue:0}, calculationBasis:{type:D.DECIMAL(18,2),allowNull:false},
  rate:D.DECIMAL(9,4), amount:{type:D.DECIMAL(18,2),allowNull:false}, directExpenses:{type:D.DECIMAL(18,2),defaultValue:0},
  instituteMargin:{type:D.DECIMAL(18,2),allowNull:false}, status:{type:D.STRING(30),allowNull:false,defaultValue:'pending'},
  payableAt:D.DATE, reversalOfId:D.BIGINT, idempotencyKey:{type:D.STRING(255),allowNull:false,unique:true}, payoutId:D.BIGINT, createdByUserId:D.BIGINT
},{tableName:'commission_ledger',timestamps:true,underscored:true});
