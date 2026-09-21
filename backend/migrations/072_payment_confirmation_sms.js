'use strict';

const LOCK = 570072;

// Payment confirmation SMS: config/template-only migration. This creates
// exactly one new student_message_templates row (channel='sms') and nothing
// else — no new tables/columns, since the durable per-payment identity it
// needs (a unique AccountingTransaction id per confirmed payment) and its
// SMS idempotency guard (sms_messages.dedupe_key, added in migration 071)
// already exist. It intentionally mirrors the EXISTING WhatsApp
// 'payment_confirmation' key (seeded by migration 019) as
// 'payment_confirmation_sms', rather than inventing a differently-named
// key, so the SMS side reuses the exact same dispatch/template lookup
// convention as every other channel pair already shipped in 071.
// This migration only ever INSERTs configuration data — it never sends a
// message, and it must not: seeding the template must never scan or replay
// historical payments.
// Same self-lock-avoidance rationale as migrations 065-071: all
// schema-inspection calls below pass { transaction } to stay on the same
// connection that holds this migration's own advisory lock.

async function tableExists(q, name, transaction) {
  return (await q.showAllTables({ transaction })).some(value => String(value?.tableName || value?.table_name || value).toLowerCase() === name);
}

module.exports = {
  async up(q) {
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query("SET LOCAL lock_timeout = '10s'", { transaction });
      await q.sequelize.query("SET LOCAL statement_timeout = '120s'", { transaction });
      await q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction });

      if (await tableExists(q, 'student_message_templates', transaction)) {
        await q.sequelize.query(
          `INSERT INTO student_message_templates (title,key,category,channel,body,buttons,is_active,automation_enabled,created_at,updated_at)
           VALUES (:title,:key,:category,'sms',:body,'[]',true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
           ON CONFLICT (key) DO NOTHING`,
          {
            replacements: {
              title: 'Payment Confirmation (SMS)',
              key: 'payment_confirmation_sms',
              category: 'Payment',
              body: 'Hello {{student_name}}, we have received your payment of Rs.{{payment_amount}} for {{course_name}}. Remaining balance: Rs.{{remaining_balance}}. Thank you! - {{company_name}}'
            },
            transaction
          }
        );
      }
    });
  },
  async down() { /* Additive migration: the new template row is safe to retain; rollback is application-first. */ }
};
