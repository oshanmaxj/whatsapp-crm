module.exports = (sequelize, D) => sequelize.define('CommissionAccountingLink', {
  id:{type:D.BIGINT,autoIncrement:true,primaryKey:true}, ledgerId:D.BIGINT, payoutId:D.BIGINT,
  accountingTransactionId:{type:D.BIGINT,allowNull:false}, linkType:{type:D.STRING(40),allowNull:false},
  reversalOfId:D.BIGINT, idempotencyKey:{type:D.STRING(255),allowNull:false,unique:true}
},{tableName:'commission_accounting_links',timestamps:true,updatedAt:false,underscored:true});
