module.exports = (sequelize, D) => sequelize.define('CommissionPayoutLedgerItem', {
  id:{type:D.BIGINT,autoIncrement:true,primaryKey:true}, payoutId:{type:D.BIGINT,allowNull:false},
  ledgerId:{type:D.BIGINT,allowNull:false}, allocatedAmount:{type:D.DECIMAL(18,2),allowNull:false}, active:{type:D.BOOLEAN,allowNull:false,defaultValue:true}
},{tableName:'commission_payout_ledger_items',timestamps:true,updatedAt:false,underscored:true});
