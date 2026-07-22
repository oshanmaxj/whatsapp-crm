const { Op } = require('sequelize');
const { sequelize, CommissionLedger, CommissionCalculationSnapshot, FeeInstallment, User, Student, Course, Batch, CommissionRule } = require('../models');
const calculation = require('./commissionCalculation.service');
const decimal = require('../utils/decimal');

const can = (actor, permission) => actor?.isSystemAdmin || actor?.permissions?.includes(permission) ||
  (permission === 'commission.view' && ['commission.view_all','commission.view_team'].some(p=>actor?.permissions?.includes(p)));
const fail = (message,status=422,code='COMMISSION_ERROR')=>Object.assign(new Error(message),{status,code});

class CommissionLedgerService {
  scope(actor, where={}) {
    if (can(actor,'commission.view')) return where;
    if (actor?.permissions?.includes('commission.view_own')) return { ...where, beneficiaryId:actor.id };
    throw fail('Commission view permission required.',403,'FORBIDDEN');
  }
  async generateForPayment(sourcePaymentId, { transaction:outer }={}) {
    const execute = async transaction => {
      const context = await calculation.contextForInstallment(sourcePaymentId, transaction);
      const result = await calculation.calculate(context,{transaction});
      const created=[];
      for (const component of result.components) {
        const idempotencyKey=[sourcePaymentId,component.beneficiaryType,component.beneficiaryId,component.ruleId||component.lecturerAgreementId||0,component.earningComponent].join(':');
        const [ledger,isNew]=await CommissionLedger.findOrCreate({ where:{idempotencyKey}, defaults:{
          sourcePaymentId,sourceAccountingTransactionId:context.accountingTransactionId,earningType:component.earningType,
          earningComponent:component.earningComponent,beneficiaryType:component.beneficiaryType,beneficiaryId:component.beneficiaryId,
          ruleId:component.ruleId||null,lecturerAgreementId:component.lecturerAgreementId||null,studentId:context.fee.studentId,enrollmentId:context.fee.enrollmentId,
          courseId:context.courseId,batchId:context.batchId,leadId:context.leadId,whatsappAccountId:context.whatsappAccountId,
          grossPayment:result.totals.grossPayment,discountAmount:context.discountAmount,refundAmount:'0.00',calculationBasis:component.basis,
          rate:component.rate||null,amount:component.amount,directExpenses:result.totals.directExpenses,instituteMargin:result.totals.instituteMargin,
          status:component.status,payableAt:new Date(Date.now()+Number(component.rule?.payoutDelayDays||0)*86400000),idempotencyKey
        },transaction });
        if(isNew) await CommissionCalculationSnapshot.create({ledgerId:ledger.id,studentName:context.student?.name,registrationNumber:context.student?.studentNo,
          courseName:context.course?.name,batchName:context.batch?.name,paymentReference:context.payment.transactionReference,paymentMethod:context.payment.paymentMethod,
          beneficiaryName:(await User.findByPk(component.beneficiaryId,{transaction}))?.get('email'),ruleName:component.rule?.name||`Lecturer agreement ${component.lecturerAgreementId}`,
          ruleVersion:component.rule?.toJSON?.()||component.agreement?.toJSON?.()||{},calculation:{...result.totals,basis:component.basis,rate:component.rate,amount:component.amount}}, {transaction});
        if(isNew&&component.status==='payable')await sequelize.query(`INSERT INTO commission_payables (ledger_id,beneficiary_type,beneficiary_id,original_amount,outstanding_amount,status,created_at,updated_at) VALUES (:ledgerId,:type,:beneficiaryId,:amount,:amount,'payable',NOW(),NOW()) ON CONFLICT (ledger_id) DO NOTHING`,{replacements:{ledgerId:ledger.id,type:ledger.beneficiaryType,beneficiaryId:ledger.beneficiaryId,amount:ledger.amount},transaction});
        created.push(ledger);
      }
      return created;
    };
    return outer?execute(outer):sequelize.transaction(execute);
  }
  async reverseForPayment(sourcePaymentId, reason='Payment reversed', { transaction:outer }={}) {
    const execute=async transaction=>{
      const originals=await CommissionLedger.findAll({where:{sourcePaymentId,reversalOfId:null},transaction,lock:transaction.LOCK.UPDATE});
      const reversals=[];
      for(const original of originals){
        const key=`reversal:${original.id}`;
        const [reversal]=await CommissionLedger.findOrCreate({where:{idempotencyKey:key},defaults:{...original.get({plain:true}),id:undefined,
          amount:decimal.format(-decimal.parse(original.amount)),grossPayment:decimal.format(-decimal.parse(original.grossPayment)),
          calculationBasis:decimal.format(-decimal.parse(original.calculationBasis)),instituteMargin:decimal.format(-decimal.parse(original.instituteMargin)),
          status:'reversed',reversalOfId:original.id,payoutId:null,idempotencyKey:key},transaction});
        await require('./commissionAccountingSync.service').reverseLedger(original,reversal,reason,transaction);
        if(original.status!=='reversed')await original.update({status:'reversed'},{transaction});
        await sequelize.query(`UPDATE commission_payables SET outstanding_amount=0,status='reversed',updated_at=NOW() WHERE ledger_id=:ledgerId`,{replacements:{ledgerId:original.id},transaction});
        reversals.push(reversal);
      }
      return reversals;
    };
    return outer?execute(outer):sequelize.transaction(execute);
  }
  async adjust(payload,actor){if(!can(actor,'commission.adjust'))throw fail('Adjustment permission required.',403,'FORBIDDEN');if(!payload.beneficiaryType||!payload.beneficiaryId||!String(payload.reason||'').trim())throw fail('Beneficiary and reason are required.');const amount=decimal.format(decimal.parse(payload.amount));if(decimal.compare(amount,0)===0)throw fail('Adjustment amount cannot be zero.');const key=`adjustment:${payload.idempotencyKey||`${actor.id}:${Date.now()}`}`;return sequelize.transaction(async transaction=>CommissionLedger.create({sourcePaymentId:payload.sourcePaymentId||null,earningType:'manual_adjustment',earningComponent:'manual_adjustment',beneficiaryType:payload.beneficiaryType,beneficiaryId:payload.beneficiaryId,grossPayment:'0.00',discountAmount:'0.00',refundAmount:'0.00',calculationBasis:'0.00',amount,directExpenses:'0.00',instituteMargin:decimal.format(-decimal.parse(amount)),status:'under_review',idempotencyKey:key,createdByUserId:actor.id},{transaction}));}
  async list(actor, query={}) {
    const page=Math.max(Number(query.page)||1,1),max=can(actor,'commission.export')?5000:100,limit=Math.min(Math.max(Number(query.limit)||25,1),max);
    const where={...(query.status?{status:query.status}:{}),...(query.beneficiaryType?{beneficiaryType:query.beneficiaryType}:{}),
      ...(query.beneficiaryId?{beneficiaryId:query.beneficiaryId}:{}),...(query.courseId?{courseId:query.courseId}:{}),...(query.batchId?{batchId:query.batchId}:{}),
      ...(query.ruleId?{ruleId:query.ruleId}:{}),...(query.payoutId?{payoutId:query.payoutId}:{}),
      ...(query.from||query.to?{createdAt:{...(query.from?{[Op.gte]:new Date(`${query.from}T00:00:00+05:30`)}:{}),...(query.to?{[Op.lte]:new Date(`${query.to}T23:59:59.999+05:30`)}:{})}}:{})};
    const search=String(query.search||'').trim();
    if(search) where[Op.or]=[{ '$student.name$':{[Op.iLike]:`%${search}%`}},{'$student.student_no$':{[Op.iLike]:`%${search}%`}},{'$beneficiary.email$':{[Op.iLike]:`%${search}%`}}];
    const result=await CommissionLedger.findAndCountAll({where:this.scope(actor,where),include:[
      {model:User,as:'beneficiary',attributes:['id','firstName','lastName','email']},{model:Student,as:'student',attributes:['id','name','studentNo']},
      {model:Course,as:'course',attributes:['id','name','code']},{model:Batch,as:'batch',required:false,attributes:['id','name','code']},
      {model:CommissionRule,as:'rule',required:false,attributes:['id','name']}],order:[['created_at','DESC'],['id','DESC']],limit,offset:(page-1)*limit,distinct:true});
    return {rows:result.rows,total:result.count,page,limit,pages:Math.ceil(result.count/limit)};
  }
}
module.exports=new CommissionLedgerService();
