'use strict';

const LOCK = 570071;

// Student SMS notifications (welcome, class reminder, birthday wish, payment
// reminder): SMS content rides entirely on the EXISTING infrastructure —
// new `*_sms` rows in student_message_templates (already has a `channel`
// column that validates 'sms', just never had any sms rows), and the
// EXISTING sms_messages table for delivery/audit history (new `source`
// values like 'student_welcome_sms', no new history table). The only new
// schema is what's genuinely needed for durable idempotency/state that
// doesn't fit anywhere existing:
//  - sms_messages.dedupe_key: a nullable, unique key automatic SMS sends
//    claim before sending, so a backend/worker restart can never double-send
//    (manual/campaign sends leave it NULL, and Postgres unique indexes treat
//    NULLs as distinct, so existing manual-send behavior is untouched).
//  - students.class_sms_reminders_enabled: the per-student opt-out toggle
//    requested for Class Reminder SMS specifically (defaults true so
//    existing/new active students keep receiving reminders once the
//    feature/template is turned on).
// Same self-lock-avoidance rationale as migrations 065-070: all
// schema-inspection calls below pass { transaction } to stay on the same
// connection that holds this migration's own advisory lock.
const PERMISSIONS = [
  ['student.class_sms_reminders.manage', 'Toggle a student\'s Class SMS Reminders on/off']
];

// SMS bodies are intentionally short/plain (no WhatsApp buttons, no rich
// formatting) and never include portal_password — unlike the WhatsApp
// student_welcome template, the welcome SMS is a plain confirmation, not a
// credential delivery channel.
const SMS_TEMPLATES = [
  {
    key: 'student_welcome_sms',
    title: 'Student Welcome (SMS)',
    category: 'Student',
    body: 'Hello {{student_name}}, welcome to {{company_name}}! Your registration number is {{registration_number}}. We are glad to have you with us.'
  },
  {
    key: 'class_reminder_sms',
    title: 'Class Reminder (SMS)',
    category: 'Class',
    body: 'Hello {{student_name}}, reminder: your {{course_name}} class ({{batch_name}}) is on {{class_date}} at {{class_time}}. - {{company_name}}'
  },
  {
    key: 'birthday_wish_sms',
    title: 'Birthday Wish (SMS)',
    category: 'Student',
    body: 'Happy Birthday {{student_name}}! Warm wishes from all of us at {{company_name}}. Have a wonderful year ahead!'
  },
  {
    key: 'payment_reminder_sms',
    title: 'Payment Reminder (SMS)',
    category: 'Payment',
    body: 'Hello {{student_name}}, this is a reminder that your installment #{{installment_no}} of Rs.{{payment_amount}} for {{course_name}} is due on {{installment_due_date}}. - {{company_name}}'
  }
];

async function tableExists(q, name, transaction) {
  return (await q.showAllTables({ transaction })).some(value => String(value?.tableName || value?.table_name || value).toLowerCase() === name);
}

async function addColumnIfMissing(q, table, column, definition, transaction) {
  const described = await q.describeTable(table, { transaction });
  if (described[column]) return;
  await q.addColumn(table, column, definition, { transaction });
}

async function addIndexIfMissing(q, table, fields, options, transaction) {
  const indexes = await q.showIndex(table, { transaction }).catch(() => []);
  if (indexes.some(index => index.name === options.name)) return;
  await q.addIndex(table, fields, { ...options, transaction });
}

module.exports = {
  async up(q, Sequelize) {
    const D = Sequelize.DataTypes;
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query("SET LOCAL lock_timeout = '10s'", { transaction });
      await q.sequelize.query("SET LOCAL statement_timeout = '120s'", { transaction });
      await q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction });

      // --- sms_messages.dedupe_key -------------------------------------------
      await addColumnIfMissing(q, 'sms_messages', 'dedupe_key', { type: D.STRING(150), allowNull: true }, transaction);
      await addIndexIfMissing(q, 'sms_messages', ['dedupe_key'], { name: 'sms_messages_dedupe_key_uq', unique: true }, transaction);

      // --- students.class_sms_reminders_enabled -------------------------------
      await addColumnIfMissing(q, 'students', 'class_sms_reminders_enabled', { type: D.BOOLEAN, allowNull: false, defaultValue: true }, transaction);

      // --- student_message_templates: seed the 4 SMS templates ----------------
      if (await tableExists(q, 'student_message_templates', transaction)) {
        for (const tpl of SMS_TEMPLATES) {
          await q.sequelize.query(
            `INSERT INTO student_message_templates (title,key,category,channel,body,buttons,is_active,automation_enabled,created_at,updated_at)
             VALUES (:title,:key,:category,'sms',:body,'[]',true,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
             ON CONFLICT (key) DO NOTHING`,
            { replacements: tpl, transaction }
          );
        }
      }

      // --- permission seeding ----------------------------------------------------
      for (const [code, name] of PERMISSIONS) await q.sequelize.query(
        `INSERT INTO permissions (code,name,description,created_at,updated_at)
         VALUES (:code,:name,:name,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
         ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,updated_at=CURRENT_TIMESTAMP`,
        { replacements: { code, name }, transaction }
      );
      await q.sequelize.query(
        `INSERT INTO role_permissions (role_id,permission_id,granted_at)
         SELECT r.id,p.id,CURRENT_TIMESTAMP FROM roles r CROSS JOIN permissions p
          WHERE LOWER(r.name) IN ('admin','administrator','system administrator') AND p.code IN (:codes)
         ON CONFLICT (role_id,permission_id) DO NOTHING`,
        { replacements: { codes: PERMISSIONS.map(([code]) => code) }, transaction }
      );
    });
  },
  async down() { /* Additive migration: new columns/templates/permissions are safe to retain; rollback is application-first. */ }
};

module.exports.constants = { PERMISSIONS, SMS_TEMPLATES };
