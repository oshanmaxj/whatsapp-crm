const LOCK = 570061;
module.exports.up = async (q) => {
  const transaction = await q.sequelize.transaction();
  try {
    await q.sequelize.query("SET LOCAL lock_timeout = '10s'", { transaction });
    await q.sequelize.query("SET LOCAL statement_timeout = '120s'", { transaction });
    await q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction });
    for (const sql of [
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS template_version VARCHAR(80)',
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS origin_event VARCHAR(80)',
      'ALTER TABLE student_automation_dispatches ADD COLUMN IF NOT EXISTS force_attempt VARCHAR(80)',
      'CREATE UNIQUE INDEX IF NOT EXISTS student_automation_dispatches_dedupe_unique ON student_automation_dispatches(dedupe_key)',
      'CREATE INDEX IF NOT EXISTS conversations_cursor_idx ON conversations(last_message_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS conversations_account_cursor_idx ON conversations(whatsapp_account_id, last_message_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS conversations_assignee_cursor_idx ON conversations(assigned_user_id, last_message_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS conversations_role_cursor_idx ON conversations(assigned_role_id, last_message_at DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS messages_conversation_history_idx ON messages(conversation_id, created_at DESC, id DESC) WHERE deleted_at IS NULL',
      'CREATE INDEX IF NOT EXISTS contacts_lower_email_idx ON contacts(LOWER(email)) WHERE email IS NOT NULL',
      'CREATE INDEX IF NOT EXISTS students_registration_idx ON students(student_no) WHERE deleted_at IS NULL'
    ]) await q.sequelize.query(sql, { transaction });
    await q.sequelize.query(`INSERT INTO permissions(code,name,description,created_at,updated_at)
      SELECT 'student.lms_credentials.reset','student.lms_credentials.reset','Reset LMS credentials and send access details',NOW(),NOW()
      WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE code='student.lms_credentials.reset')`, { transaction });
    await transaction.commit();
  } catch (error) { await transaction.rollback(); error.migrationOperation = '061_onboarding_inbox_pagination.js'; throw error; }
};
module.exports.down = async () => {};
