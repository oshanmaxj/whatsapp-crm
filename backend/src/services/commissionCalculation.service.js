const { sequelize, FeeInstallment, StudentFee, Student, Course, Batch, StudentEnrollment, CommissionLedger } = require('../models');
const decimal = require('../utils/decimal');
const rules = require('./commissionRule.service');
const agreements = require('./lecturerAgreement.service');

function calculatedAmount(config, basis, metric = 1) {
  const type = config.calculationType || config.commissionType;
  let amount = '0.00';
  if (['percentage_collected','percentage_after_discount','percentage_net_revenue','percentage'].includes(type)) amount = decimal.multiply(basis, config.percentageRate || 0);
  else if (['fixed_payment','fixed_registration','fixed_installment','fixed','fixed_student','fixed_batch'].includes(type)) amount = String(config.fixedAmount || config.paymentPerStudent || '0');
  else if (type === 'fixed_session') amount = decimal.format(decimal.parse(config.paymentPerSession || 0) * BigInt(config.numberOfSessions || 0));
  else if (String(type).startsWith('tiered')) {
    const tiers=(config.tierConfiguration || config.tiers || []).map(tier=>tier.toJSON?tier.toJSON():tier);
    const tier = tiers.find(item=>metric>=Number(item.minimumCount??item.minimum_count??0)&&((item.maximumCount??item.maximum_count)==null||metric<=Number(item.maximumCount??item.maximum_count)));
    amount = tier?.percentageRate != null ? decimal.multiply(basis, tier.percentageRate) : String(tier?.fixedAmount || 0);
  }
  if (config.allocationPercentage != null) amount = decimal.multiply(amount, config.allocationPercentage);
  if (config.maximumCap != null) amount = decimal.min(amount, config.maximumCap);
  if (config.maximumCommissionAmount != null) amount = decimal.min(amount, config.maximumCommissionAmount);
  return decimal.format(decimal.parse(amount));
}

class CommissionCalculationService {
  async contextForInstallment(id, transaction) {
    const payment = await FeeInstallment.findByPk(id, { include:[{ model:StudentFee, as:'fee', include:[{model:Student,as:'student'},{model:Course,as:'course'},{model:Batch,as:'batch',required:false}] }], transaction, lock: transaction?.LOCK?.UPDATE });
    if (!payment || !['confirmed','paid'].includes(payment.status) || decimal.compare(payment.paidAmount, 0) <= 0) throw Object.assign(new Error('Only a confirmed payment can generate earnings.'), { status:409, code:'PAYMENT_NOT_CONFIRMED' });
    const fee = payment.fee;
    const collectedAmount=decimal.format(decimal.parse(payment.paidAmount));
    const discountAmount=decimal.prorate(fee.discountAmount||0,collectedAmount,fee.totalAmount||collectedAmount);
    return { payment, fee, student:fee.student, course:fee.course, batch:fee.batch, sourcePaymentId:payment.id,
      accountingTransactionId:payment.accountingTransactionId, agentUserId:payment.creditedToUserId, courseId:fee.courseId,
      batchId:fee.batchId, whatsappAccountId:payment.whatsappAccountId, departmentId:payment.attributionDepartmentId, paymentMethod:payment.paymentMethod,
      collectedAmount, grossAmount:decimal.add(collectedAmount,discountAmount), discountAmount,
      confirmedDate:payment.confirmedAt || payment.paidDate || new Date(), leadId:fee.student?.leadId };
  }

  async calculate(context, { transaction } = {}) {
    const ruleResult = await rules.resolve(context, { transaction });
    const lecturerAgreements = await agreements.activeFor({ courseId:context.courseId, batchId:context.batchId, date:context.confirmedDate }, transaction);
    const studentCount=await StudentEnrollment.count({where:{courseId:context.courseId,...(context.batchId?{batchId:context.batchId}:{})},transaction});
    const components = [];
    for (const rule of ruleResult.selected) {
      const beneficiaryId = rule.beneficiaryId || (rule.earningType === 'agent_commission' ? context.agentUserId : null);
      if (!beneficiaryId) continue;
      if (rule.calculationType === 'fixed_registration' && await CommissionLedger.count({ where:{ ruleId:rule.id, beneficiaryId, studentId:context.fee.studentId, courseId:context.courseId, reversalOfId:null }, transaction })) continue;
      if (rule.calculationType === 'fixed_batch' && await CommissionLedger.count({ where:{ ruleId:rule.id, beneficiaryId, batchId:context.batchId, reversalOfId:null }, transaction })) continue;
      components.push({ earningType:rule.earningType, earningComponent:`rule:${rule.id}`, beneficiaryType:rule.beneficiaryType || (rule.earningType === 'agent_commission' ? 'agent':'user'), beneficiaryId,
        ruleId:rule.id, basis:context.collectedAmount, rate:rule.percentageRate, amount:calculatedAmount(rule, context.collectedAmount,studentCount), status:rule.approvalRequired ? 'pending':'payable', rule });
    }
    const agentShare=decimal.add(...components.filter(component=>component.earningType==='agent_commission').map(component=>component.amount));
    for (const agreement of lecturerAgreements) {
      const basis=agreement.revenueBasis==='net_after_agent_commission'?decimal.subtract(context.collectedAmount,agentShare):context.collectedAmount;
      if (['fixed_student','fixed_registration'].includes(agreement.calculationType) && await CommissionLedger.count({ where:{ lecturerAgreementId:agreement.id, beneficiaryId:agreement.lecturerUserId, studentId:context.fee.studentId, reversalOfId:null }, transaction })) continue;
      if (agreement.calculationType === 'fixed_batch' && await CommissionLedger.count({ where:{ lecturerAgreementId:agreement.id, beneficiaryId:agreement.lecturerUserId, batchId:context.batchId, reversalOfId:null }, transaction })) continue;
      components.push({ earningType:'lecturer_fee', earningComponent:`agreement:${agreement.id}`, beneficiaryType:'lecturer', beneficiaryId:agreement.lecturerUserId,
        lecturerAgreementId:agreement.id, basis, rate:agreement.percentageRate || agreement.allocationPercentage, amount:calculatedAmount(agreement, basis,studentCount), status:'pending', agreement });
    }
    const totalEarnings = decimal.add(...components.map(item => item.amount));
    const [expenseRows]=await sequelize.query(`SELECT COALESCE(SUM(amount),0)::text amount FROM commission_expense_allocations WHERE source_payment_id=:paymentId`,{replacements:{paymentId:context.sourcePaymentId||0},transaction});
    const directExpenses=decimal.format(decimal.parse(expenseRows[0]?.amount||0));
    const instituteMargin = decimal.subtract(context.collectedAmount, totalEarnings, directExpenses);
    components.push({earningType:'institute_margin',earningComponent:'institute_margin',beneficiaryType:'institute',beneficiaryId:0,basis:context.collectedAmount,rate:null,amount:instituteMargin,status:'approved'});
    return { context, matchedRules:ruleResult.selected, excludedRules:ruleResult.evaluated.filter(item=>!item.matched).map(item=>({ id:item.rule.id,name:item.rule.name,reason:item.reason })), components, totals:{ grossPayment:context.grossAmount||context.collectedAmount, discount:context.discountAmount||'0.00', refund:'0.00', netCollected:context.collectedAmount, earnings:totalEarnings, directExpenses, instituteMargin } };
  }

  async preview(payload) {
    const context = payload.sourcePaymentId ? await this.contextForInstallment(payload.sourcePaymentId) : { ...payload, collectedAmount:decimal.format(decimal.parse(payload.collectedAmount)), confirmedDate:payload.confirmedDate || new Date() };
    return this.calculate(context);
  }
}
module.exports = new CommissionCalculationService();
module.exports.calculatedAmount = calculatedAmount;
