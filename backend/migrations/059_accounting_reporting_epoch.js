const LOCK = 570059;
const name = '059_accounting_reporting_epoch.js';

module.exports.up = async (q) => {
  const transaction = await q.sequelize.transaction();
  try {
    await q.sequelize.query("SET LOCAL lock_timeout = '10s'", { transaction });
    await q.sequelize.query("SET LOCAL statement_timeout = '120s'", { transaction });
    await q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction });
    await q.sequelize.query(`CREATE TABLE IF NOT EXISTS accounting_reporting_epochs (
      id BIGSERIAL PRIMARY KEY,
      tracking_started_at TIMESTAMPTZ NOT NULL,
      changed_by_user_id BIGINT REFERENCES users(id),
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reason TEXT NOT NULL,
      previous_tracking_started_at TIMESTAMPTZ,
      timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Colombo'
    )`, { transaction });
    await q.sequelize.query('CREATE INDEX IF NOT EXISTS accounting_reporting_epochs_changed_at_idx ON accounting_reporting_epochs(changed_at DESC, id DESC)', { transaction });
    await q.sequelize.query('ALTER TABLE accounting_transactions ADD COLUMN IF NOT EXISTS source_event_at TIMESTAMPTZ', { transaction });
    await q.sequelize.query('ALTER TABLE accounting_transactions ADD COLUMN IF NOT EXISTS source_type VARCHAR(60)', { transaction });
    await q.sequelize.query('ALTER TABLE accounting_transactions ADD COLUMN IF NOT EXISTS source_id VARCHAR(120)', { transaction });
    await q.sequelize.query(`UPDATE accounting_transactions at SET
      source_event_at = COALESCE(
        (SELECT COALESCE(fi.confirmed_at, fi.recorded_at, fi.paid_date::timestamp, fi.created_at) FROM fee_installments fi WHERE fi.accounting_transaction_id=at.id LIMIT 1),
        (SELECT COALESCE(fi.confirmed_at, fi.recorded_at, fi.paid_date::timestamp, fi.updated_at) FROM fee_installments fi WHERE fi.reversal_accounting_transaction_id=at.id LIMIT 1),
        (SELECT pr.receipt_date FROM payment_receipts pr WHERE pr.payment_id=at.id ORDER BY pr.id LIMIT 1),
        at.date::timestamp, at.created_at
      ),
      source_type = COALESCE(source_type,
        CASE WHEN EXISTS(SELECT 1 FROM fee_installments fi WHERE fi.accounting_transaction_id=at.id) THEN 'fee_installment_payment'
             WHEN EXISTS(SELECT 1 FROM fee_installments fi WHERE fi.reversal_accounting_transaction_id=at.id) THEN 'fee_installment_reversal'
             WHEN EXISTS(SELECT 1 FROM commission_accounting_links cal WHERE cal.accounting_transaction_id=at.id) THEN 'commission_accounting'
             WHEN EXISTS(SELECT 1 FROM payment_slips ps WHERE ps.approved_payment_id=at.id) THEN 'payment_slip'
             ELSE 'manual' END),
      source_id = COALESCE(source_id,
        (SELECT fi.id::text FROM fee_installments fi WHERE fi.accounting_transaction_id=at.id LIMIT 1),
        (SELECT fi.id::text FROM fee_installments fi WHERE fi.reversal_accounting_transaction_id=at.id LIMIT 1),
        (SELECT cal.idempotency_key FROM commission_accounting_links cal WHERE cal.accounting_transaction_id=at.id LIMIT 1),
        (SELECT ps.id::text FROM payment_slips ps WHERE ps.approved_payment_id=at.id LIMIT 1)
      )
      WHERE source_event_at IS NULL OR source_type IS NULL`, { transaction });
    await q.sequelize.query('ALTER TABLE accounting_transactions ALTER COLUMN source_event_at SET NOT NULL', { transaction });
    await q.sequelize.query('CREATE INDEX IF NOT EXISTS accounting_transactions_source_event_idx ON accounting_transactions(source_event_at, type)', { transaction });
    await q.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS accounting_transactions_source_identity_unique
      ON accounting_transactions(source_type, source_id) WHERE source_id IS NOT NULL AND source_type <> 'manual'`, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    error.migrationOperation = name;
    throw error;
  }
};

module.exports.down = async () => {};
