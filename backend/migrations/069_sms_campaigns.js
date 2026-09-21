'use strict';

const LOCK = 570069;

// Phase 3 of the SMS gateway integration: bulk SMS campaigns, in their own
// parallel tables (sms_campaigns / sms_campaign_recipients) — deliberately
// NOT sharing the WhatsApp campaigns/campaign_recipients tables or the
// MessageQueue worker, to avoid any risk to the existing WhatsApp broadcast
// system (see services/smsCampaignWorker.service.js for the isolated
// worker this schema backs). Provider-neutral throughout: `provider`/
// `provider_message_id` mirror the same convention already used by
// sms_messages (067/068) — no SMSGo-specific columns anywhere.
// Same self-lock-avoidance rationale as migrations 065-068: all
// schema-inspection calls below pass { transaction } to stay on the same
// connection that holds this migration's own lock.
const PERMISSIONS = [
  ['sms_campaigns.view', 'View SMS Campaigns'],
  ['sms_campaigns.create', 'Create SMS Campaigns'],
  ['sms_campaigns.send', 'Send/Schedule SMS Campaigns'],
  ['sms_campaigns.manage', 'Manage SMS Campaigns (edit, pause, resume, cancel, retry, delete)']
];

async function tableExists(q, name, transaction) {
  return (await q.showAllTables({ transaction })).some(value => String(value?.tableName || value?.table_name || value).toLowerCase() === name);
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

      const timestamps = {
        created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      };

      // --- sms_campaigns -------------------------------------------------------
      if (!await tableExists(q, 'sms_campaigns', transaction)) await q.createTable('sms_campaigns', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        name: { type: D.STRING(180), allowNull: false },
        message: { type: D.TEXT, allowNull: false },
        sender_mask: { type: D.STRING(40), allowNull: true },
        provider: { type: D.STRING(40), allowNull: true },
        mode: { type: D.STRING(10), allowNull: true },
        status: { type: D.STRING(20), allowNull: false, defaultValue: 'draft' },
        recipient_source: { type: D.STRING(20), allowNull: false, defaultValue: 'manual' },
        audience_config: { type: D.JSONB, allowNull: false, defaultValue: {} },
        total_recipients: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
        queued_count: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
        sent_count: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
        delivered_count: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
        failed_count: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
        rejected_count: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
        scheduled_at: { type: D.DATE, allowNull: true },
        started_at: { type: D.DATE, allowNull: true },
        completed_at: { type: D.DATE, allowNull: true },
        paused_at: { type: D.DATE, allowNull: true },
        cancelled_at: { type: D.DATE, allowNull: true },
        last_error: { type: D.TEXT, allowNull: true },
        created_by: { type: D.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        deleted_at: { type: D.DATE, allowNull: true },
        ...timestamps
      }, { transaction });

      await addIndexIfMissing(q, 'sms_campaigns', ['status'], { name: 'sms_campaigns_status_idx' }, transaction);
      await addIndexIfMissing(q, 'sms_campaigns', ['scheduled_at'], { name: 'sms_campaigns_scheduled_at_idx' }, transaction);
      await addIndexIfMissing(q, 'sms_campaigns', ['provider'], { name: 'sms_campaigns_provider_idx' }, transaction);

      // --- sms_campaign_recipients ----------------------------------------------
      if (!await tableExists(q, 'sms_campaign_recipients', transaction)) await q.createTable('sms_campaign_recipients', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        campaign_id: { type: D.BIGINT, allowNull: false, references: { model: 'sms_campaigns', key: 'id' }, onDelete: 'CASCADE' },
        contact_id: { type: D.BIGINT, allowNull: true, references: { model: 'contacts', key: 'id' }, onDelete: 'SET NULL' },
        lead_id: { type: D.BIGINT, allowNull: true, references: { model: 'leads', key: 'id' }, onDelete: 'SET NULL' },
        student_id: { type: D.BIGINT, allowNull: true, references: { model: 'students', key: 'id' }, onDelete: 'SET NULL' },
        phone: { type: D.STRING(20), allowNull: false },
        recipient_name: { type: D.STRING(200), allowNull: true },
        personalized_message: { type: D.TEXT, allowNull: true },
        // Preserves which CRM entities (possibly more than one — e.g. the
        // same phone as both a Contact and a Lead) resolved to this phone,
        // even though only one SMS is ever sent to it. Shape: [{type, id}].
        matched_entities: { type: D.JSONB, allowNull: true },
        status: { type: D.STRING(20), allowNull: false, defaultValue: 'pending' },
        provider: { type: D.STRING(40), allowNull: true },
        provider_message_id: { type: D.STRING(255), allowNull: true },
        sms_message_id: { type: D.BIGINT, allowNull: true, references: { model: 'sms_messages', key: 'id' }, onDelete: 'SET NULL' },
        error_message: { type: D.TEXT, allowNull: true },
        // Drives both the worker's auto-retry decision and manual
        // "retry eligible" — a permanent failure (invalid phone, mask not
        // approved, bad credentials) is never auto-retried, and is excluded
        // from manual retry unless something about the campaign changes.
        is_permanent_failure: { type: D.BOOLEAN, allowNull: true },
        attempts: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
        max_attempts: { type: D.INTEGER, allowNull: false, defaultValue: 3 },
        next_attempt_at: { type: D.DATE, allowNull: true },
        claimed_at: { type: D.DATE, allowNull: true },
        worker_id: { type: D.STRING(160), allowNull: true },
        queued_at: { type: D.DATE, allowNull: true },
        sent_at: { type: D.DATE, allowNull: true },
        delivered_at: { type: D.DATE, allowNull: true },
        failed_at: { type: D.DATE, allowNull: true },
        ...timestamps
      }, { transaction });

      await addIndexIfMissing(q, 'sms_campaign_recipients', ['campaign_id'], { name: 'sms_campaign_recipients_campaign_idx' }, transaction);
      await addIndexIfMissing(q, 'sms_campaign_recipients', ['status'], { name: 'sms_campaign_recipients_status_idx' }, transaction);
      await addIndexIfMissing(q, 'sms_campaign_recipients', ['phone'], { name: 'sms_campaign_recipients_phone_idx' }, transaction);
      await addIndexIfMissing(q, 'sms_campaign_recipients', ['campaign_id', 'status'], { name: 'sms_campaign_recipients_campaign_status_idx' }, transaction);
      await addIndexIfMissing(q, 'sms_campaign_recipients', ['sms_message_id'], { name: 'sms_campaign_recipients_sms_message_idx' }, transaction);
      await addIndexIfMissing(q, 'sms_campaign_recipients', ['provider_message_id'], { name: 'sms_campaign_recipients_provider_message_idx' }, transaction);
      // Enforces "deduplicate recipients within a campaign by canonical
      // phone number" at the database level, not just in application code.
      await addIndexIfMissing(q, 'sms_campaign_recipients', ['campaign_id', 'phone'], { name: 'sms_campaign_recipients_campaign_phone_uq', unique: true }, transaction);

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
  async down() { /* Additive migration: new tables/permissions are safe to retain; rollback is application-first. */ }
};

module.exports.constants = { PERMISSIONS };
