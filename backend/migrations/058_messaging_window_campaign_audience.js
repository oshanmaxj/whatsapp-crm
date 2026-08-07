const LOCK = 570058;
const name = '058_messaging_window_campaign_audience.js';

module.exports.up = async (q) => {
  const transaction = await q.sequelize.transaction();
  try {
    await q.sequelize.query("SET LOCAL lock_timeout = '10s'", { transaction });
    await q.sequelize.query("SET LOCAL statement_timeout = '120s'", { transaction });
    await q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction });
    const [tables] = await q.sequelize.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name IN ('messages','campaign_recipients')", { transaction });
    const names = new Set(tables.map(row => row.table_name));
    if (names.has('campaign_recipients')) {
      await q.sequelize.query(`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_type WHERE typname='enum_campaign_recipients_status')
           AND NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='enum_campaign_recipients_status' AND e.enumlabel='skipped')
        THEN ALTER TYPE enum_campaign_recipients_status ADD VALUE 'skipped'; END IF;
      END $$`, { transaction });
    }
    if (names.has('messages')) {
      await q.sequelize.query("CREATE INDEX IF NOT EXISTS messages_window_lookup_idx ON messages(conversation_id, whatsapp_account_id, created_at DESC) WHERE direction='inbound' AND deleted_at IS NULL", { transaction });
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    error.migrationOperation = name;
    throw error;
  }
};

module.exports.down = async () => {};
