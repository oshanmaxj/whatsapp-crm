'use strict';

const LOCK = 570067;

// Phase 1 of the SMS gateway integration: adds the sms_messages log table
// used by ad-hoc/test sends. The schema is provider-neutral by design —
// SMSGo is the first provider adapter (see services/sms/providers/), but
// nothing here names it: `provider` records which adapter handled a given
// message, `provider_message_id`/`provider_status` are that provider's own
// identifiers, and `provider_metadata` holds whatever raw, provider-specific
// response shape (e.g. SMSGo's sandbox/live mode, its response body) needs
// preserving without giving it a first-class column. Gateway configuration
// itself (enabled flag, active provider, provider-specific credentials)
// reuses the existing generic `app_settings` table (namespace 'sms_gateway')
// the same way Facebook integration settings already do (see
// facebookSettings.service.js) — no settings table migration is needed for
// that part.
// See the same self-lock-avoidance rationale as migrations 065/066: all
// schema-inspection calls below pass { transaction } to stay on the same
// connection that holds this migration's own lock.
const PERMISSIONS = [
  ['sms.send', 'Send SMS Messages']
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

      // --- sms_messages -------------------------------------------------------
      if (!await tableExists(q, 'sms_messages', transaction)) await q.createTable('sms_messages', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        to_number: { type: D.STRING(20), allowNull: false },
        message: { type: D.TEXT, allowNull: false },
        mask: { type: D.STRING(40), allowNull: true },
        status: { type: D.STRING(20), allowNull: false, defaultValue: 'queued' },
        provider: { type: D.STRING(40), allowNull: true },
        provider_message_id: { type: D.STRING(255), allowNull: true },
        provider_status: { type: D.STRING(60), allowNull: true },
        provider_metadata: { type: D.JSONB, allowNull: true },
        campaign_name: { type: D.STRING(180), allowNull: true },
        error_message: { type: D.TEXT, allowNull: true },
        segments: { type: D.INTEGER, allowNull: true },
        cost: { type: D.DECIMAL(10, 4), allowNull: true },
        source: { type: D.STRING(40), allowNull: false, defaultValue: 'manual' },
        contact_id: { type: D.BIGINT, allowNull: true, references: { model: 'contacts', key: 'id' }, onDelete: 'SET NULL' },
        lead_id: { type: D.BIGINT, allowNull: true, references: { model: 'leads', key: 'id' }, onDelete: 'SET NULL' },
        student_id: { type: D.BIGINT, allowNull: true, references: { model: 'students', key: 'id' }, onDelete: 'SET NULL' },
        created_by: { type: D.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        sent_at: { type: D.DATE, allowNull: true },
        delivered_at: { type: D.DATE, allowNull: true },
        failed_at: { type: D.DATE, allowNull: true },
        ...timestamps
      }, { transaction });

      await addIndexIfMissing(q, 'sms_messages', ['status'], { name: 'sms_messages_status_idx' }, transaction);
      await addIndexIfMissing(q, 'sms_messages', ['provider'], { name: 'sms_messages_provider_idx' }, transaction);
      await addIndexIfMissing(q, 'sms_messages', ['provider_message_id'], { name: 'sms_messages_provider_message_id_idx' }, transaction);
      await addIndexIfMissing(q, 'sms_messages', ['to_number'], { name: 'sms_messages_to_number_idx' }, transaction);
      await addIndexIfMissing(q, 'sms_messages', ['created_at'], { name: 'sms_messages_created_at_idx' }, transaction);

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
  async down() { /* Additive migration: new table/permissions are safe to retain; rollback is application-first. */ }
};

module.exports.constants = { PERMISSIONS };
