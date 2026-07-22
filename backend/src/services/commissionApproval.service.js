const { sequelize, CommissionLedger, CommissionApproval, CommissionPayout }=require('../models');
const can=(actor,p)=>actor?.isSystemAdmin||actor?.permissions?.includes(p);
const fail=(m,s=422)=>Object.assign(new Error(m),{status:s});
class CommissionApprovalService{
 async act({ledgerId,payoutId,action,comment,ipAddress,userAgent},actor){if(!can(actor,action==='reverse'?'commission.reverse':'commission.approve'))throw fail('Approval permission required.',403);
  return sequelize.transaction(async transaction=>{const row=ledgerId?await CommissionLedger.findByPk(ledgerId,{transaction,lock:transaction.LOCK.UPDATE}):await CommissionPayout.findByPk(payoutId,{transaction,lock:transaction.LOCK.UPDATE});if(!row)throw fail('Financial record not found.',404);
   if(row.createdByUserId&&String(row.createdByUserId)===String(actor.id)&&!actor.isSystemAdmin)throw fail('Users cannot approve their own payout or adjustment.',403);
   const before=row.status;const map={approve:ledgerId?'payable':'approved',reject:'rejected',hold:'held',release:'pending',reverse:'reversed'};const after=map[action];if(!after)throw fail('Unsupported approval action.');
   await row.update({status:after,...(action==='approve'?{approvedByUserId:actor.id}:{})},{transaction});
   if(ledgerId&&action==='approve')await sequelize.query(`INSERT INTO commission_payables (ledger_id,beneficiary_type,beneficiary_id,original_amount,outstanding_amount,status,created_at,updated_at) VALUES (:ledgerId,:type,:beneficiaryId,:amount,:amount,'payable',NOW(),NOW()) ON CONFLICT (ledger_id) DO NOTHING`,{replacements:{ledgerId:row.id,type:row.beneficiaryType,beneficiaryId:row.beneficiaryId,amount:row.amount},transaction});
   if(ledgerId&&['reject','reverse'].includes(action))await sequelize.query(`UPDATE commission_payables SET outstanding_amount=0,status=:status,updated_at=NOW() WHERE ledger_id=:ledgerId`,{replacements:{ledgerId:row.id,status:after},transaction});
   await CommissionApproval.create({ledgerId:ledgerId||null,payoutId:payoutId||null,approverUserId:actor.id,approverRole:actor.role||null,action,comment,beforeStatus:before,afterStatus:after,ipAddress,userAgent},{transaction});return row;});}
 async bulk(ids,action,comment,actor,metadata={}){if(!Array.isArray(ids)||!ids.length)throw fail('Select at least one ledger entry.');const results=[];for(const id of ids)results.push(await this.act({ledgerId:id,action,comment,...metadata},actor));return{count:results.length,results};}
}
module.exports=new CommissionApprovalService();
