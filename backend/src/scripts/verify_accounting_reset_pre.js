require('../config/loadEnv');
const { QueryTypes } = require('sequelize');
const sequelize = require('../config/database');

async function run() {
  const proposed = process.argv[2] || process.env.ACCOUNTING_PROPOSED_EPOCH;
  if (!proposed || Number.isNaN(new Date(proposed).getTime())) throw new Error('Pass the proposed ISO reset timestamp as the first argument.');
  const [totals, sources, references, currentEpoch] = await Promise.all([
    sequelize.query(`SELECT type,COUNT(*)::int row_count,COALESCE(SUM(amount),0)::text total,MIN(source_event_at) earliest,MAX(source_event_at) latest FROM accounting_transactions GROUP BY type ORDER BY type`, { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT COALESCE(source_type,'unknown') source_type,COUNT(*)::int row_count,COALESCE(SUM(amount),0)::text total FROM accounting_transactions GROUP BY 1 ORDER BY 1`, { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT
      (SELECT COUNT(*) FROM fee_installments WHERE accounting_transaction_id IS NOT NULL)::int installment_payment_refs,
      (SELECT COUNT(*) FROM fee_installments WHERE reversal_accounting_transaction_id IS NOT NULL)::int installment_reversal_refs,
      (SELECT COUNT(*) FROM payment_receipts)::int receipt_refs,
      (SELECT COUNT(*) FROM commission_accounting_links)::int commission_link_refs,
      (SELECT COUNT(*) FROM commission_expense_allocations)::int commission_allocation_refs`, { type: QueryTypes.SELECT }),
    sequelize.query('SELECT * FROM accounting_reporting_epochs ORDER BY changed_at DESC,id DESC LIMIT 1', { type: QueryTypes.SELECT })
  ]);
  const proposedImpact = await sequelize.query(`SELECT type,COUNT(*)::int historical_rows,COALESCE(SUM(amount),0)::text historical_total FROM accounting_transactions WHERE source_event_at < :proposed GROUP BY type ORDER BY type`, { replacements: { proposed: new Date(proposed) }, type: QueryTypes.SELECT });
  console.log(JSON.stringify({ proposedTrackingStartedAt: new Date(proposed).toISOString(), currentEpoch: currentEpoch[0] || null, totals, sources, references: references[0], proposedImpact }, null, 2));
}
run().then(() => sequelize.close()).catch(error => { console.error(error.message); sequelize.close().finally(() => { process.exitCode = 1; }); });
