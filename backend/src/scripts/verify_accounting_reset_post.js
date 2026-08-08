require('../config/loadEnv');
const { QueryTypes } = require('sequelize');
const sequelize = require('../config/database');

async function run() {
  const rows = await sequelize.query(`WITH epoch AS (SELECT tracking_started_at FROM accounting_reporting_epochs ORDER BY changed_at DESC,id DESC LIMIT 1)
    SELECT type,COUNT(*)::int row_count,COALESCE(SUM(amount),0)::text total FROM accounting_transactions,epoch WHERE source_event_at>=epoch.tracking_started_at GROUP BY type ORDER BY type`, { type: QueryTypes.SELECT });
  const [epoch, preserved] = await Promise.all([
    sequelize.query('SELECT * FROM accounting_reporting_epochs ORDER BY changed_at DESC,id DESC LIMIT 1', { type: QueryTypes.SELECT }),
    sequelize.query(`SELECT (SELECT COUNT(*) FROM students)::int students,(SELECT COUNT(*) FROM student_enrollments)::int enrollments,(SELECT COUNT(*) FROM fee_installments)::int installments,(SELECT COUNT(*) FROM payment_receipts)::int receipts,(SELECT COUNT(*) FROM commission_ledger)::int commission_rows`, { type: QueryTypes.SELECT })
  ]);
  console.log(JSON.stringify({ epoch: epoch[0] || null, currentPeriodTotals: rows, preservedOperationalCounts: preserved[0] }, null, 2));
}
run().then(() => sequelize.close()).catch(error => { console.error(error.message); sequelize.close().finally(() => { process.exitCode = 1; }); });
