require('dotenv').config();
const { sequelize }=require('../models');
(async()=>{const checks={
 confirmedPaymentsWithoutLedger:`SELECT fi.id FROM fee_installments fi LEFT JOIN commission_ledger cl ON cl.source_payment_id=fi.id AND cl.reversal_of_id IS NULL WHERE fi.status IN ('confirmed','paid') AND cl.id IS NULL`,
 duplicateLedger:`SELECT source_payment_id,beneficiary_type,beneficiary_id,rule_id,earning_component,COUNT(*) count FROM commission_ledger WHERE reversal_of_id IS NULL GROUP BY 1,2,3,4,5 HAVING COUNT(*)>1`,
 ledgerWithoutPayment:`SELECT cl.id FROM commission_ledger cl LEFT JOIN fee_installments fi ON fi.id=cl.source_payment_id WHERE fi.id IS NULL`,
 paidWithoutExpense:`SELECT cl.id FROM commission_ledger cl JOIN commission_payouts p ON p.id=cl.payout_id LEFT JOIN accounting_transactions at ON at.id=p.accounting_expense_transaction_id WHERE cl.status='paid' AND at.id IS NULL`,
 payoutMismatch:`SELECT id,payout_number,net_payable,actual_paid FROM commission_payouts WHERE status='paid' AND net_payable<>actual_paid`,
 reversedPaymentWithoutLedgerReversal:`SELECT fi.id FROM fee_installments fi JOIN commission_ledger cl ON cl.source_payment_id=fi.id AND cl.reversal_of_id IS NULL LEFT JOIN commission_ledger rev ON rev.reversal_of_id=cl.id WHERE fi.status='reversed' AND rev.id IS NULL`,
 missingLecturerAgreement:`SELECT DISTINCT fi.id FROM fee_installments fi JOIN student_fees sf ON sf.id=fi.fee_id LEFT JOIN lecturer_agreements la ON la.course_id=sf.course_id AND la.status='active' WHERE fi.status IN ('confirmed','paid') AND la.id IS NULL`,
 negativeInstituteMargin:`SELECT id,source_payment_id,institute_margin FROM commission_ledger WHERE institute_margin<0 AND reversal_of_id IS NULL`,
 conflictingActiveRules:`SELECT earning_type,scope_type,COALESCE(scope_id,0) scope_id,COALESCE(beneficiary_id,0) beneficiary_id,COUNT(*) count FROM commission_rules WHERE status='active' AND exclusive=TRUE AND deleted_at IS NULL GROUP BY 1,2,3,4 HAVING COUNT(*)>1`
 };const output={generatedAt:new Date().toISOString(),timezone:'Asia/Colombo',checks:{}};for(const[name,sql]of Object.entries(checks)){const[rows]=await sequelize.query(sql);output.checks[name]={count:rows.length,rows};}process.stdout.write(`${JSON.stringify(output,null,2)}\n`);await sequelize.close();})().catch(async error=>{process.stderr.write(`${error.stack}\n`);await sequelize.close().catch(()=>{});process.exit(1);});
