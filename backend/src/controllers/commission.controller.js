const rules=require('../services/commissionRule.service');
const calculation=require('../services/commissionCalculation.service');
const agreements=require('../services/lecturerAgreement.service');
const ledger=require('../services/commissionLedger.service');
const approvals=require('../services/commissionApproval.service');
const payouts=require('../services/commissionPayout.service');
const accounting=require('../services/commissionAccountingSync.service');
const reporting=require('../services/commissionReporting.service');
const ok=(res,data,status=200)=>res.status(status).json({success:true,data});
const wrap=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(error){next(error);}};
const meta=req=>({ipAddress:req.ip,userAgent:req.get('user-agent')});
module.exports={
 dashboard:wrap(async(req,res)=>ok(res,await reporting.dashboard(req.user,req.query))),
 list:wrap(async(req,res)=>ok(res,await ledger.list(req.user,req.query))),
 rules:wrap(async(req,res)=>ok(res,await rules.list(req.query))),
 createRule:wrap(async(req,res)=>ok(res,await rules.save(null,req.body,req.user),201)),
 updateRule:wrap(async(req,res)=>ok(res,await rules.save(req.params.id,req.body,req.user))),
 preview:wrap(async(req,res)=>ok(res,await calculation.preview(req.body))),
 agreements:wrap(async(req,res)=>ok(res,await agreements.list(req.query))),
 createAgreement:wrap(async(req,res)=>ok(res,await agreements.save(null,req.body,req.user),201)),
 updateAgreement:wrap(async(req,res)=>ok(res,await agreements.save(req.params.id,req.body,req.user))),
 action:wrap(async(req,res)=>ok(res,await approvals.act({ledgerId:req.params.id,action:req.params.action,comment:req.body.reason||req.body.comment,...meta(req)},req.user))),
 bulkApproval:wrap(async(req,res)=>ok(res,await approvals.bulk(req.body.ids,req.body.action,req.body.comment,req.user,meta(req)))),
 adjustment:wrap(async(req,res)=>ok(res,await ledger.adjust(req.body,req.user),201)),
 payouts:wrap(async(req,res)=>ok(res,await payouts.list(req.query))),
 createPayout:wrap(async(req,res)=>ok(res,await payouts.create(req.body,req.user),201)),
 payoutAction:wrap(async(req,res)=>{const action=req.params.action;const result=action==='approve'?await payouts.approve(req.params.id,req.user):action==='paid'||action==='pay'?await payouts.pay(req.params.id,req.body,req.user):action==='cancel'?await payouts.cancel(req.params.id,req.user):await approvals.act({payoutId:req.params.id,action,comment:req.body.comment,...meta(req)},req.user);ok(res,result);}),
 profitability:wrap(async(req,res)=>ok(res,await reporting.profitability(req.user,req.query))),
 report:wrap(async(req,res)=>ok(res,await reporting.report(req.params.name,req.user,req.query))),
 export:wrap(async(req,res)=>{if(!req.user?.isSystemAdmin&&!req.user?.permissions?.includes('commission.export'))throw Object.assign(new Error('Export permission required.'),{status:403});const data=await reporting.report(req.params.name,req.user,{...req.query,limit:10000});res.type('text/csv').attachment(`${req.params.name}.csv`).send(reporting.toCsv(data));}),
 reconciliation:wrap(async(req,res)=>ok(res,await accounting.reconcile()))
};
