'use strict';

const LOCK = 570068;

// Phase 2 of the SMS gateway integration: a provider-neutral webhook
// idempotency ledger (mirrors facebook_webhook_events exactly) plus the
// `sms.view` permission for the SMS History page. `provider` records which
// adapter delivered the event; nothing here is SMSGo-specific — the same
// table serves any future provider's webhook deliveries.
const PERMISSIONS = [
  ['sms.view', 'View SMS History']
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

      // --- sms_webhook_events -------------------------------------------------
      if (!await tableExists(q, 'sms_webhook_events', transaction)) await q.createTable('sms_webhook_events', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        event_key: { type: D.STRING(255), allowNull: false, unique: true },
        provider: { type: D.STRING(40), allowNull: false },
        event_type: { type: D.STRING(64), allowNull: false },
        payload: { type: D.JSONB, allowNull: false },
        received_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        processed_at: { type: D.DATE, allowNull: true },
        status: { type: D.STRING(32), allowNull: false, defaultValue: 'received' },
        error_details: { type: D.TEXT, allowNull: true }
      }, { transaction });

      await addIndexIfMissing(q, 'sms_webhook_events', ['provider'], { name: 'sms_webhook_events_provider_idx' }, transaction);
      await addIndexIfMissing(q, 'sms_webhook_events', ['status'], { name: 'sms_webhook_events_status_idx' }, transaction);

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
  async down() { /* Additive migration: new table/permission are safe to retain; rollback is application-first. */ }
};

module.exports.constants = { PERMISSIONS };
