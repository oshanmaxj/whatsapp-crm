'use strict';

const LOCK = 570065;

const PERMISSIONS = [
  ['facebook-pages.view', 'View Facebook Pages'],
  ['facebook-pages.edit', 'Manage Facebook Pages'],
  ['facebook-messenger.view', 'View Facebook Messenger Inbox'],
  ['facebook-messenger.send', 'Send Facebook Messenger Messages'],
  ['facebook-comments.view', 'View Facebook Comments'],
  ['facebook-comments.reply', 'Reply to Facebook Comments']
];

async function tableExists(q, name) {
  return (await q.showAllTables()).some(value => String(value?.tableName || value?.table_name || value).toLowerCase() === name);
}

async function addColumnIfMissing(q, table, column, definition, transaction) {
  const described = await q.describeTable(table);
  if (described[column]) return;
  await q.addColumn(table, column, definition, { transaction });
}

async function addIndexIfMissing(q, table, fields, options, transaction) {
  const indexes = await q.showIndex(table).catch(() => []);
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

      // --- facebook_pages -------------------------------------------------
      if (!await tableExists(q, 'facebook_pages')) await q.createTable('facebook_pages', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        name: { type: D.STRING(255), allowNull: false },
        page_id: { type: D.STRING(64), allowNull: false, unique: true },
        page_access_token_encrypted: { type: D.TEXT, allowNull: false },
        app_id: { type: D.STRING(64), allowNull: true },
        active: { type: D.BOOLEAN, allowNull: false, defaultValue: true },
        webhook_subscribed: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
        send_enabled: { type: D.BOOLEAN, allowNull: false, defaultValue: true },
        created_by: { type: D.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        ...timestamps
      }, { transaction });

      // --- facebook_contacts -----------------------------------------------
      if (!await tableExists(q, 'facebook_contacts')) await q.createTable('facebook_contacts', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        facebook_page_id: { type: D.BIGINT, allowNull: false, references: { model: 'facebook_pages', key: 'id' }, onDelete: 'CASCADE' },
        facebook_psid: { type: D.STRING(64), allowNull: false },
        contact_id: { type: D.BIGINT, allowNull: true, references: { model: 'contacts', key: 'id' }, onDelete: 'SET NULL' },
        display_name: { type: D.STRING(255), allowNull: true },
        profile_picture_url: { type: D.STRING(1024), allowNull: true },
        ...timestamps
      }, { transaction });

      // --- facebook_comments -------------------------------------------------
      if (!await tableExists(q, 'facebook_comments')) await q.createTable('facebook_comments', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        facebook_page_id: { type: D.BIGINT, allowNull: false, references: { model: 'facebook_pages', key: 'id' }, onDelete: 'CASCADE' },
        meta_comment_id: { type: D.STRING(128), allowNull: false, unique: true },
        meta_post_id: { type: D.STRING(128), allowNull: false },
        parent_comment_id: { type: D.STRING(128), allowNull: true },
        facebook_psid: { type: D.STRING(64), allowNull: true },
        contact_id: { type: D.BIGINT, allowNull: true, references: { model: 'contacts', key: 'id' }, onDelete: 'SET NULL' },
        lead_id: { type: D.BIGINT, allowNull: true, references: { model: 'leads', key: 'id' }, onDelete: 'SET NULL' },
        assigned_user_id: { type: D.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        message: { type: D.TEXT, allowNull: true },
        created_time: { type: D.DATE, allowNull: false },
        hidden: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
        deleted: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
        replied: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
        ...timestamps
      }, { transaction });

      // --- facebook_webhook_events -------------------------------------------
      if (!await tableExists(q, 'facebook_webhook_events')) await q.createTable('facebook_webhook_events', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        event_key: { type: D.STRING(255), allowNull: false, unique: true },
        event_type: { type: D.STRING(64), allowNull: false },
        object_type: { type: D.STRING(32), allowNull: false },
        facebook_page_id: { type: D.BIGINT, allowNull: true, references: { model: 'facebook_pages', key: 'id' }, onDelete: 'SET NULL' },
        payload: { type: D.JSONB, allowNull: false },
        received_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        processed_at: { type: D.DATE, allowNull: true },
        status: { type: D.STRING(32), allowNull: false, defaultValue: 'received' },
        error_details: { type: D.TEXT, allowNull: true }
      }, { transaction });

      // --- user_facebook_pages -------------------------------------------------
      if (!await tableExists(q, 'user_facebook_pages')) await q.createTable('user_facebook_pages', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        user_id: { type: D.BIGINT, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
        facebook_page_id: { type: D.BIGINT, allowNull: false, references: { model: 'facebook_pages', key: 'id' }, onDelete: 'CASCADE' },
        ...timestamps
      }, { transaction });

      // --- indexes -------------------------------------------------------------
      await addIndexIfMissing(q, 'facebook_contacts', ['facebook_page_id', 'facebook_psid'], { name: 'facebook_contacts_page_psid_uq', unique: true }, transaction);
      await addIndexIfMissing(q, 'facebook_contacts', ['contact_id'], { name: 'facebook_contacts_contact_idx' }, transaction);
      await addIndexIfMissing(q, 'facebook_comments', ['facebook_page_id'], { name: 'facebook_comments_page_idx' }, transaction);
      await addIndexIfMissing(q, 'facebook_comments', ['meta_post_id'], { name: 'facebook_comments_post_idx' }, transaction);
      await addIndexIfMissing(q, 'facebook_comments', ['contact_id'], { name: 'facebook_comments_contact_idx' }, transaction);
      await addIndexIfMissing(q, 'facebook_comments', ['lead_id'], { name: 'facebook_comments_lead_idx' }, transaction);
      await addIndexIfMissing(q, 'facebook_comments', ['assigned_user_id'], { name: 'facebook_comments_assigned_user_idx' }, transaction);
      await addIndexIfMissing(q, 'facebook_webhook_events', ['facebook_page_id'], { name: 'facebook_webhook_events_page_idx' }, transaction);
      await addIndexIfMissing(q, 'facebook_webhook_events', ['status'], { name: 'facebook_webhook_events_status_idx' }, transaction);
      await addIndexIfMissing(q, 'user_facebook_pages', ['user_id', 'facebook_page_id'], { name: 'user_facebook_pages_user_page_uq', unique: true }, transaction);
      await addIndexIfMissing(q, 'user_facebook_pages', ['user_id'], { name: 'user_facebook_pages_user_idx' }, transaction);
      await addIndexIfMissing(q, 'user_facebook_pages', ['facebook_page_id'], { name: 'user_facebook_pages_page_idx' }, transaction);

      // --- additive columns on existing tables ----------------------------------
      await addColumnIfMissing(q, 'users', 'all_facebook_pages', { type: D.BOOLEAN, allowNull: false, defaultValue: true }, transaction);

      await addColumnIfMissing(q, 'conversations', 'channel', { type: D.STRING(20), allowNull: false, defaultValue: 'whatsapp' }, transaction);
      await addColumnIfMissing(q, 'conversations', 'facebook_page_id', { type: D.BIGINT, allowNull: true, references: { model: 'facebook_pages', key: 'id' }, onDelete: 'SET NULL' }, transaction);
      await addColumnIfMissing(q, 'conversations', 'facebook_thread_key', { type: D.STRING(255), allowNull: true, unique: true }, transaction);
      await addIndexIfMissing(q, 'conversations', ['facebook_page_id'], { name: 'conversations_facebook_page_idx' }, transaction);
      await addIndexIfMissing(q, 'conversations', ['channel'], { name: 'conversations_channel_idx' }, transaction);

      await addColumnIfMissing(q, 'messages', 'facebook_page_id', { type: D.BIGINT, allowNull: true, references: { model: 'facebook_pages', key: 'id' }, onDelete: 'SET NULL' }, transaction);
      await addColumnIfMissing(q, 'messages', 'facebook_message_id', { type: D.STRING(255), allowNull: true, unique: true }, transaction);
      await addIndexIfMissing(q, 'messages', ['facebook_page_id'], { name: 'messages_facebook_page_idx' }, transaction);

      await addColumnIfMissing(q, 'leads', 'facebook_page_id', { type: D.BIGINT, allowNull: true, references: { model: 'facebook_pages', key: 'id' }, onDelete: 'SET NULL' }, transaction);
      await addIndexIfMissing(q, 'leads', ['facebook_page_id'], { name: 'leads_facebook_page_idx' }, transaction);

      await addColumnIfMissing(q, 'flows', 'channel', { type: D.STRING(20), allowNull: false, defaultValue: 'whatsapp' }, transaction);
      await addColumnIfMissing(q, 'flows', 'facebook_page_id', { type: D.BIGINT, allowNull: true, references: { model: 'facebook_pages', key: 'id' }, onDelete: 'SET NULL' }, transaction);

      await addColumnIfMissing(q, 'flow_runs', 'channel', { type: D.STRING(20), allowNull: false, defaultValue: 'whatsapp' }, transaction);
      await addColumnIfMissing(q, 'flow_runs', 'facebook_page_id', { type: D.BIGINT, allowNull: true, references: { model: 'facebook_pages', key: 'id' }, onDelete: 'SET NULL' }, transaction);
      await addColumnIfMissing(q, 'flow_runs', 'last_facebook_message_id', { type: D.STRING(255), allowNull: true }, transaction);

      // contacts.phone: relax NOT NULL so a Facebook-only contact (no phone number)
      // can be created. Existing rows keep their phone; the unique index still
      // permits multiple NULLs under Postgres.
      const contactsDescribed = await q.describeTable('contacts');
      if (contactsDescribed.phone && contactsDescribed.phone.allowNull === false) {
        await q.changeColumn('contacts', 'phone', { type: D.STRING(50), allowNull: true }, { transaction });
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
  async down() { /* Additive migration: new tables/columns are safe to retain; rollback is application-first. */ }
};

module.exports.constants = { PERMISSIONS };
