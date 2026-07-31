const LOCK = 570057;
const name = '057_reminder_reply_policy.js';
const POLICIES = ['postpone', 'continue', 'pause', 'stop', 'complete', 'flow_decides'];

module.exports.up = async (q, S) => {
  const transaction = await q.sequelize.transaction();
  try {
    await q.sequelize.query("SET LOCAL lock_timeout = '10s'", { transaction });
    await q.sequelize.query("SET LOCAL statement_timeout = '120s'", { transaction });
    await q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction });
    const sequenceColumns = await q.describeTable('reminder_sequences', { transaction });
    const subscriptionColumns = await q.describeTable('reminder_subscriptions', { transaction });
    const add = async (table, columns, column, definition) => {
      if (!columns[column]) { console.log(`[${name}] add ${table}.${column}`); await q.addColumn(table, column, definition, { transaction }); }
    };
    await add('reminder_sequences', sequenceColumns, 'reply_policy', { type: S.STRING(30), allowNull: true });
    await add('reminder_sequences', sequenceColumns, 'reply_cooldown_value', { type: S.INTEGER, allowNull: false, defaultValue: 4 });
    await add('reminder_sequences', sequenceColumns, 'reply_cooldown_unit', { type: S.STRING(10), allowNull: false, defaultValue: 'hours' });
    await add('reminder_subscriptions', subscriptionColumns, 'last_recipient_reply_at', { type: S.DATE });
    await add('reminder_subscriptions', subscriptionColumns, 'last_recipient_reply_message_id', { type: S.STRING(255) });
    await add('reminder_subscriptions', subscriptionColumns, 'reply_resume_at', { type: S.DATE });
    await add('reminder_subscriptions', subscriptionColumns, 'stopped_by_reply_at', { type: S.DATE });
    await q.sequelize.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reminder_sequences_reply_policy_check') THEN ALTER TABLE reminder_sequences ADD CONSTRAINT reminder_sequences_reply_policy_check CHECK (reply_policy IS NULL OR reply_policy IN (${POLICIES.map(x=>`'${x}'`).join(',')})); END IF; END $$`, { transaction });
    await q.sequelize.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reminder_sequences_reply_cooldown_unit_check') THEN ALTER TABLE reminder_sequences ADD CONSTRAINT reminder_sequences_reply_cooldown_unit_check CHECK (reply_cooldown_unit IN ('minutes','hours','days')); END IF; END $$", { transaction });
    const [duplicates] = await q.sequelize.query("SELECT sequence_id,conversation_id,whatsapp_account_id,count(*)::int AS count FROM reminder_subscriptions WHERE status IN ('active','paused') GROUP BY 1,2,3 HAVING count(*)>1", { transaction });
    console.log(`[${name}] duplicate live subscription groups: ${duplicates.length}`);
    if (duplicates.length) await q.sequelize.query("WITH ranked AS (SELECT id,row_number() OVER(PARTITION BY sequence_id,conversation_id,whatsapp_account_id ORDER BY created_at DESC,id DESC) AS rn FROM reminder_subscriptions WHERE status IN ('active','paused')) UPDATE reminder_subscriptions s SET status='cancelled',cancelled_at=NOW(),next_run_at=NULL,metadata=COALESCE(s.metadata,'{}'::jsonb)||'{\"deduplicatedByMigration\":true}'::jsonb FROM ranked r WHERE s.id=r.id AND r.rn>1", { transaction });
    await q.sequelize.query("CREATE UNIQUE INDEX IF NOT EXISTS reminder_subscriptions_one_live_identity ON reminder_subscriptions(sequence_id,conversation_id,whatsapp_account_id) WHERE status IN ('active','paused')", { transaction });
    await transaction.commit();
  } catch (error) { await transaction.rollback(); error.migrationOperation = name; throw error; }
};
module.exports.down = async () => {};
