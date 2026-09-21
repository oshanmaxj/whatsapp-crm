'use strict';

const LOCK = 570070;

// Facebook comment keyword auto-hide: a new rules table
// (facebook_comment_auto_hide_rules) plus additive audit/status columns on
// the existing facebook_comments table. Deliberately extends
// facebook_comments rather than adding a separate attempt/audit table —
// there is exactly one current auto-hide outcome per comment (not a
// repeating multi-attempt log), and the snapshot columns
// (auto_hide_keyword/auto_hide_match_type) already preserve the historical
// "why" independent of whether the rule that matched still exists, so a
// second table would add join overhead without adding information.
// Same self-lock-avoidance rationale as migrations 065-069: all
// schema-inspection calls below pass { transaction } to stay on the same
// connection that holds this migration's own advisory lock.
const PERMISSIONS = [
  ['facebook-comment-auto-hide.view', 'View Facebook Comment Auto-Hide Rules'],
  ['facebook-comment-auto-hide.manage', 'Manage Facebook Comment Auto-Hide Rules'],
  ['facebook-comments.hide', 'Hide/Unhide Facebook Comments']
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

      const timestamps = {
        created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      };

      // --- facebook_comment_auto_hide_rules ---------------------------------
      if (!await tableExists(q, 'facebook_comment_auto_hide_rules', transaction)) await q.createTable('facebook_comment_auto_hide_rules', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        keyword: { type: D.STRING(255), allowNull: false },
        match_type: { type: D.STRING(20), allowNull: false, defaultValue: 'contains' },
        case_sensitive: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
        enabled: { type: D.BOOLEAN, allowNull: false, defaultValue: true },
        // NULL = applies to every Facebook Page the system manages.
        facebook_page_id: { type: D.BIGINT, allowNull: true, references: { model: 'facebook_pages', key: 'id' }, onDelete: 'CASCADE' },
        created_by: { type: D.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        ...timestamps
      }, { transaction });

      await addIndexIfMissing(q, 'facebook_comment_auto_hide_rules', ['facebook_page_id'], { name: 'facebook_comment_auto_hide_rules_page_idx' }, transaction);
      await addIndexIfMissing(q, 'facebook_comment_auto_hide_rules', ['enabled'], { name: 'facebook_comment_auto_hide_rules_enabled_idx' }, transaction);

      // --- additive columns on facebook_comments -----------------------------
      await addColumnIfMissing(q, 'facebook_comments', 'auto_hide_matched', { type: D.BOOLEAN, allowNull: false, defaultValue: false }, transaction);
      await addColumnIfMissing(q, 'facebook_comments', 'auto_hide_rule_id', { type: D.BIGINT, allowNull: true, references: { model: 'facebook_comment_auto_hide_rules', key: 'id' }, onDelete: 'SET NULL' }, transaction);
      // Snapshots of the matched rule at hide-time, so editing/deleting the
      // rule later never destroys the historical explanation for why a
      // specific comment was hidden.
      await addColumnIfMissing(q, 'facebook_comments', 'auto_hide_keyword', { type: D.STRING(255), allowNull: true }, transaction);
      await addColumnIfMissing(q, 'facebook_comments', 'auto_hide_match_type', { type: D.STRING(20), allowNull: true }, transaction);
      await addColumnIfMissing(q, 'facebook_comments', 'auto_hide_status', { type: D.STRING(20), allowNull: false, defaultValue: 'not_matched' }, transaction);
      await addColumnIfMissing(q, 'facebook_comments', 'auto_hidden_at', { type: D.DATE, allowNull: true }, transaction);
      await addColumnIfMissing(q, 'facebook_comments', 'auto_hide_error', { type: D.TEXT, allowNull: true }, transaction);
      await addColumnIfMissing(q, 'facebook_comments', 'auto_hide_attempted_at', { type: D.DATE, allowNull: true }, transaction);

      await addIndexIfMissing(q, 'facebook_comments', ['auto_hide_rule_id'], { name: 'facebook_comments_auto_hide_rule_idx' }, transaction);
      await addIndexIfMissing(q, 'facebook_comments', ['auto_hide_status'], { name: 'facebook_comments_auto_hide_status_idx' }, transaction);

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

      // The global enable/disable flag itself is NOT seeded here: it lives
      // on the generic app_settings table (namespace='facebook',
      // key='comment_auto_hide'), which is application-managed via
      // AppSetting.findOrCreate (see facebookCommentAutoHideRule.service.js,
      // mirroring facebookSettings.service.js's own row() method) rather
      // than migration-seeded — app_settings has no migration-defined unique
      // constraint to safely target with ON CONFLICT, and findOrCreate's
      // { enabled: false } default already guarantees auto-hide ships OFF
      // until an admin explicitly enables it, with no migration-time write
      // needed at all.
    });
  },
  async down() { /* Additive migration: new table/columns are safe to retain; rollback is application-first. */ }
};

module.exports.constants = { PERMISSIONS };
