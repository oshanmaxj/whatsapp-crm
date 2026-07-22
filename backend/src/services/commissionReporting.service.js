const { sequelize }=require('../models');
const ledger=require('./commissionLedger.service');
class CommissionReportingService{
 async dashboard(actor,filters={}){ledger.scope(actor,{});const viewAll=actor?.isSystemAdmin||['commission.view','commission.view_all','commission.view_team'].some(p=>actor?.permissions?.includes(p));const replacements={from:filters.from||'1900-01-01',to:filters.to||'2999-12-31',beneficiaryId:viewAll?null:actor.id};const [rows]=await sequelize.query(`WITH scoped AS (
  SELECT * FROM commission_ledger WHERE (created_at AT TIME ZONE 'Asia/Colombo')::date BETWEEN :from::date AND :to::date AND (:beneficiaryId IS NULL OR beneficiary_id=:beneficiaryId)
 ), payments AS (SELECT source_payment_id,MAX(gross_payment) gross_payment,MAX(direct_expenses) direct_expenses,MAX(institute_margin) institute_margin FROM scoped WHERE reversal_of_id IS NULL GROUP BY source_payment_id)
 SELECT (SELECT COALESCE(SUM(gross_payment),0)::text FROM payments) gross_revenue,
  COALESCE(SUM(amount) FILTER(WHERE earning_type='agent_commission'),0)::text agent_commissions,
  COALESCE(SUM(amount) FILTER(WHERE earning_type='lecturer_fee'),0)::text lecturer_fees,
  COALESCE(SUM(amount) FILTER(WHERE earning_type NOT IN ('agent_commission','lecturer_fee','institute_margin')),0)::text other_commissions,
  (SELECT COALESCE(SUM(direct_expenses),0)::text FROM payments) direct_expenses,
  (SELECT COALESCE(SUM(institute_margin),0)::text FROM payments) contribution_margin,
  ((SELECT COALESCE(SUM(institute_margin),0) FROM payments)-(SELECT COALESCE(SUM(amount),0) FROM commission_expense_allocations WHERE source_payment_id IS NULL))::text net_margin,
  COUNT(*) FILTER(WHERE status IN ('pending','under_review'))::int pending_approvals,
  COALESCE(SUM(amount) FILTER(WHERE status IN ('payable','partially_paid')),0)::text total_payable,
  COALESCE(SUM(amount) FILTER(WHERE status='paid'),0)::text paid,
  COALESCE(SUM(amount) FILTER(WHERE status='reversed'),0)::text reversals FROM scoped`,{replacements});return rows[0];}
 async profitability(actor,filters={}){if(!actor?.isSystemAdmin&&!actor?.permissions?.includes('commission.profitability_view'))throw Object.assign(new Error('Profitability permission required.'),{status:403});const [rows]=await sequelize.query(`WITH payments AS (SELECT source_payment_id,course_id,batch_id,MAX(gross_payment) gross_revenue,COALESCE(SUM(amount) FILTER(WHERE earning_type<>'institute_margin'),0) commissions,MAX(direct_expenses) direct_expenses,MAX(institute_margin) contribution_margin FROM commission_ledger WHERE reversal_of_id IS NULL GROUP BY source_payment_id,course_id,batch_id), grouped AS (SELECT course_id,batch_id,SUM(gross_revenue) gross_revenue,SUM(commissions) commissions,SUM(direct_expenses) direct_expenses,SUM(contribution_margin) contribution_margin FROM payments GROUP BY course_id,batch_id) SELECT g.course_id,g.batch_id,g.gross_revenue::text,g.commissions::text,g.direct_expenses::text,g.contribution_margin::text,COALESCE(e.allocated_expenses,0)::text allocated_expenses,(g.contribution_margin-COALESCE(e.allocated_expenses,0))::text net_margin FROM grouped g LEFT JOIN LATERAL (SELECT SUM(amount) allocated_expenses FROM commission_expense_allocations WHERE source_payment_id IS NULL AND ((allocation_type='course' AND allocation_id=g.course_id) OR (allocation_type='batch' AND allocation_id=g.batch_id))) e ON TRUE ORDER BY g.course_id,g.batch_id`);return rows;}
 async report(name,actor,filters={}){if(name==='profitability')return this.profitability(actor,filters);if(name==='reconciliation')return require('./commissionAccountingSync.service').reconcile();return ledger.list(actor,{...filters,limit:100});}
 toCsv(rows){const data=rows?.rows||rows;if(!data?.length)return'';const plain=data.map(r=>r.toJSON?r.toJSON():r);const keys=Object.keys(plain[0]).filter(k=>typeof plain[0][k]!=='object');const cell=v=>`"${String(v??'').replace(/"/g,'""')}"`;return[keys.map(cell).join(','),...plain.map(row=>keys.map(k=>cell(row[k])).join(','))].join('\n');}
}
module.exports=new CommissionReportingService();
