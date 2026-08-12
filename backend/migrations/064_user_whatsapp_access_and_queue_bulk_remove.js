'use strict';

const PERMISSIONS = [
  ['whatsapp_number_access.manage', 'Manage WhatsApp Number Access'],
  ['call_queue.bulk_remove', 'Remove Selected Queue Entries'],
  ['call_queue.bulk_reassign', 'Reassign Selected Queue Entries']
];

async function tableExists(q, name) {
  return (await q.showAllTables()).some(value => String(value?.tableName || value?.table_name || value).toLowerCase() === name);
}

module.exports = {
  async up(q, Sequelize) {
    const D = Sequelize.DataTypes;
    await q.sequelize.transaction(async transaction => {
      const users = await q.describeTable('users');
      if (!users.all_whatsapp_accounts) await q.addColumn('users', 'all_whatsapp_accounts', {
        type: D.BOOLEAN, allowNull: false, defaultValue: true
      }, { transaction });
      if (!await tableExists(q, 'user_whatsapp_accounts')) await q.createTable('user_whatsapp_accounts', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        user_id: { type: D.BIGINT, allowNull: false, references: { model: 'users', key: 'id' }, onDelete: 'CASCADE' },
        whatsapp_account_id: { type: D.BIGINT, allowNull: false, references: { model: 'whatsapp_accounts', key: 'id' }, onDelete: 'CASCADE' },
        created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      }, { transaction });
      const indexes = await q.showIndex('user_whatsapp_accounts').catch(() => []);
      const add = async (fields, name, unique = false) => {
        if (!indexes.some(index => index.name === name)) await q.addIndex('user_whatsapp_accounts', fields, { name, unique, transaction });
      };
      await add(['user_id', 'whatsapp_account_id'], 'user_whatsapp_accounts_user_account_uq', true);
      await add(['user_id'], 'user_whatsapp_accounts_user_idx');
      await add(['whatsapp_account_id'], 'user_whatsapp_accounts_account_idx');
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
      await q.sequelize.query(
        `INSERT INTO role_permissions (role_id,permission_id,granted_at)
         SELECT rp.role_id,p_bulk.id,CURRENT_TIMESTAMP
           FROM role_permissions rp
           JOIN permissions p_manage ON p_manage.id=rp.permission_id AND p_manage.code='call_queue.manage_own'
           JOIN permissions p_bulk ON p_bulk.code='call_queue.bulk_remove'
         ON CONFLICT (role_id,permission_id) DO NOTHING`,
        { transaction }
      );
    });
  },
  async down() { /* Additive security migration: rollback is application-first; retain access data. */ }
};

module.exports.constants = { PERMISSIONS };
