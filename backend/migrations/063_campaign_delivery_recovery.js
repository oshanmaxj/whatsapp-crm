const LOCK = 570063;

module.exports.up = async (q) => {
  const transaction = await q.sequelize.transaction();
  try {
    await q.sequelize.query("SET LOCAL lock_timeout = '10s'", { transaction });
    await q.sequelize.query("SET LOCAL statement_timeout = '120s'", { transaction });
    await q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction });
    for (const sql of [
      'ALTER TABLE message_queue ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ',
      'ALTER TABLE message_queue ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ',
      'ALTER TABLE message_queue ADD COLUMN IF NOT EXISTS worker_id VARCHAR(160)',
      'ALTER TABLE message_queue ADD COLUMN IF NOT EXISTS error_details JSONB',
      'ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ',
      'ALTER TABLE campaign_recipients ADD COLUMN IF NOT EXISTS error_details JSONB',
      'ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ',
      'ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMPTZ',
      'ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ',
      'ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_error TEXT',
      'ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS total_recipients INTEGER NOT NULL DEFAULT 0'
    ]) await q.sequelize.query(sql, { transaction });
    await q.sequelize.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM message_queue WHERE campaign_id IS NOT NULL AND campaign_recipient_id IS NOT NULL GROUP BY campaign_id,campaign_recipient_id HAVING COUNT(*) > 1)
      THEN RAISE EXCEPTION 'Duplicate campaign delivery jobs require read-only inspection before migration 063 can enforce idempotency';
      ELSIF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='message_queue_campaign_recipient_unique')
      THEN CREATE UNIQUE INDEX message_queue_campaign_recipient_unique ON message_queue(campaign_id,campaign_recipient_id)
        WHERE campaign_id IS NOT NULL AND campaign_recipient_id IS NOT NULL;
      END IF;
    END $$`, { transaction });
    await q.sequelize.query(`CREATE INDEX IF NOT EXISTS message_queue_claimable_idx
      ON message_queue(status, scheduled_at, locked_at)`, { transaction });
    await transaction.commit();
  } catch (error) { await transaction.rollback(); throw error; }
};

module.exports.down = async () => {};
