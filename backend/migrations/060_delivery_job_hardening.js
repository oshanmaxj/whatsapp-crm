const LOCK = 570060;

module.exports.up = async (q) => {
  const transaction = await q.sequelize.transaction();
  try {
    await q.sequelize.query("SET LOCAL lock_timeout = '10s'", { transaction });
    await q.sequelize.query("SET LOCAL statement_timeout = '120s'", { transaction });
    await q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction });
    for (const sql of [
      'ALTER TABLE payment_receipt_jobs ADD COLUMN IF NOT EXISTS external_message_id VARCHAR(255)',
      'ALTER TABLE payment_receipt_jobs ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ',
      'ALTER TABLE payment_receipt_jobs ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ',
      'ALTER TABLE payment_receipt_jobs ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ',
      'ALTER TABLE payment_receipt_jobs ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ',
      'ALTER TABLE payment_receipt_jobs ADD COLUMN IF NOT EXISTS last_error_code VARCHAR(120)',
      'ALTER TABLE payment_receipt_jobs ADD COLUMN IF NOT EXISTS terminal BOOLEAN NOT NULL DEFAULT FALSE',
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS enrollment_id BIGINT REFERENCES student_enrollments(id)',
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS whatsapp_account_id BIGINT REFERENCES whatsapp_accounts(id)',
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS whatsapp_message_id VARCHAR(255)',
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 3',
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS last_error_message TEXT',
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ',
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ',
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ',
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ'
    ]) await q.sequelize.query(sql, { transaction });
    await q.sequelize.query('CREATE INDEX IF NOT EXISTS payment_receipt_jobs_external_message_idx ON payment_receipt_jobs(external_message_id)', { transaction });
    await q.sequelize.query('CREATE INDEX IF NOT EXISTS student_automation_dispatches_message_idx ON student_automation_dispatches(whatsapp_message_id)', { transaction });
    for (const code of ['student.onboarding.send', 'student.onboarding.force_resend', 'receipts.retry_delivery', 'accounting.reset_maintenance']) {
      await q.sequelize.query(`INSERT INTO permissions (code,name,description,created_at,updated_at)
        SELECT :code,:code,:code,NOW(),NOW() WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code=:code)`, { replacements: { code }, transaction });
    }
    await transaction.commit();
  } catch (error) { await transaction.rollback(); throw error; }
};

module.exports.down = async () => {};
