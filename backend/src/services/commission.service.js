// Compatibility facade for payment confirmation and older callers. Canonical logic lives
// in focused services so controllers never own financial calculations.
const ledger=require('./commissionLedger.service');
const rules=require('./commissionRule.service');
const calculation=require('./commissionCalculation.service');
const approvals=require('./commissionApproval.service');
const payouts=require('./commissionPayout.service');
const reporting=require('./commissionReporting.service');
module.exports={
 generateForInstallment:(id,options)=>ledger.generateForPayment(id,options),
 reverseForInstallment:(id,reason,options)=>ledger.reverseForPayment(id,reason,options),
 resolveRule:async context=>(await rules.resolve({...context,collectedAmount:context.collectedAmount||0,confirmedDate:context.date||new Date()})).selected[0]||null,
 preview:payload=>calculation.preview(payload), dashboard:(actor,q)=>reporting.dashboard(actor,q), list:(actor,q)=>ledger.list(actor,q),
 listRules:q=>rules.list(q), saveRule:(id,p,actor)=>rules.save(id,p,actor),
 action:(id,action,p,actor)=>approvals.act({ledgerId:id,action,comment:p.reason},actor),
 createPayout:(p,actor)=>payouts.create(p,actor), payoutAction:(id,action,p,actor)=>action==='approve'?payouts.approve(id,actor):payouts.pay(id,p,actor),
 listPayouts:q=>payouts.list(q)
};
