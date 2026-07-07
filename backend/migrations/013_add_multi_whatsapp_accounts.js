const crypto = require('crypto');

async function tableExists(queryInterface, table) {
  return Boolean(await queryInterface.describeTable(table).catch(() => null));
}

async function columnExists(queryInterface, table, column) {
  const definition = await queryInterface.describeTable(table).catch(() => null);
  return Boolean(definition && Object.prototype.hasOwnProperty.call(definition, column));
}

function encrypted(value) {
  if (!value) return '';
  if (String(value).startsWith('enc:')) return String(value);
  const source = process.env.APP_SETTINGS_ENCRYPTION_KEY || process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET || '';
  const key = crypto.createHash('sha256').update(source).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `enc:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${body.toString('base64')}`;
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const types = Sequelize.DataTypes;
    if (!await tableExists(queryInterface, 'whatsapp_accounts')) {
      await queryInterface.createTable('whatsapp_accounts', {
        id: { type: types.BIGINT.UNSIGNED, autoIncrement: true, primaryKey: true, allowNull: false },
        name: { type: types.STRING(150), allowNull: false },
        phone_number: { type: types.STRING(50), allowNull: true },
        phone_number_id: { type: types.STRING(150), allowNull: false, unique: true },
        business_account_id: { type: types.STRING(150), allowNull: true },
        access_token_encrypted: { type: types.TEXT, allowNull: false },
        webhook_verify_token: { type: types.STRING(255), allowNull: true },
        app_id: { type: types.STRING(150), allowNull: true },
        app_secret_encrypted: { type: types.TEXT, allowNull: true },
        api_version: { type: types.STRING(30), allowNull: false, defaultValue: 'v17.0' },
        api_base_url: { type: types.STRING(255), allowNull: false, defaultValue: 'https://graph.facebook.com' },
        status: { type: types.ENUM('active', 'inactive'), allowNull: false, defaultValue: 'active' },
        is_default: { type: types.BOOLEAN, allowNull: false, defaultValue: false },
        last_tested_at: { type: types.DATE, allowNull: true },
        created_by: { type: types.BIGINT.UNSIGNED, allowNull: true },
        created_at: { type: types.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: types.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('whatsapp_accounts', ['phone_number_id'], { unique: true, name: 'whatsapp_accounts_phone_number_id_unique' });
      await queryInterface.addIndex('whatsapp_accounts', ['status']);
      await queryInterface.addIndex('whatsapp_accounts', ['is_default']);
    }

    const [existingRows] = await queryInterface.sequelize.query('SELECT id FROM whatsapp_accounts LIMIT 1');
    const [legacyRows] = await queryInterface.sequelize.query(
      "SELECT value FROM app_settings WHERE namespace = 'whatsapp' AND key = 'cloud_api' LIMIT 1"
    ).catch(() => [[]]);
    let legacy = legacyRows[0]?.value || {};
    if (typeof legacy === 'string') {
      try { legacy = JSON.parse(legacy); } catch { legacy = {}; }
    }
    const phoneNumberId = legacy.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = legacy.accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '';
    if (!existingRows.length && phoneNumberId) {
      await queryInterface.bulkInsert('whatsapp_accounts', [{
        name: 'Default WhatsApp Number',
        phone_number: process.env.WHATSAPP_PHONE_NUMBER || null,
        phone_number_id: phoneNumberId,
        business_account_id: legacy.businessAccountId || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || null,
        access_token_encrypted: encrypted(accessToken),
        webhook_verify_token: legacy.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN || null,
        app_id: legacy.appId || process.env.WHATSAPP_APP_ID || null,
        app_secret_encrypted: legacy.appSecret ? encrypted(legacy.appSecret) : (process.env.WHATSAPP_APP_SECRET ? encrypted(process.env.WHATSAPP_APP_SECRET) : null),
        api_version: legacy.apiVersion || process.env.WHATSAPP_API_VERSION || 'v17.0',
        api_base_url: legacy.apiBaseUrl || process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com',
        status: 'active',
        is_default: true,
        created_at: new Date(),
        updated_at: new Date()
      }]);
    }

    const accountTables = [
      'conversations', 'messages', 'contacts', 'leads', 'whatsapp_templates', 'campaigns',
      'campaign_recipients', 'message_queue', 'flows', 'flow_runs', 'auto_replies', 'whatsapp_compliance_logs'
    ];
    for (const table of accountTables) {
      if (!await tableExists(queryInterface, table)) continue;
      if (!await columnExists(queryInterface, table, 'whatsapp_account_id')) {
        await queryInterface.addColumn(table, 'whatsapp_account_id', { type: types.BIGINT.UNSIGNED, allowNull: true });
      }
      const indexName = `${table}_whatsapp_account_id_idx`;
      const indexes = await queryInterface.showIndex(table).catch(() => []);
      if (!indexes.some((index) => index.name === indexName)) {
        await queryInterface.addIndex(table, ['whatsapp_account_id'], { name: indexName });
      }
    }
    const [defaults] = await queryInterface.sequelize.query('SELECT id FROM whatsapp_accounts WHERE is_default = true LIMIT 1');
    const defaultId = defaults[0]?.id;
    if (defaultId) {
      for (const table of accountTables) {
        if (await columnExists(queryInterface, table, 'whatsapp_account_id')) {
          await queryInterface.bulkUpdate(table, { whatsapp_account_id: defaultId }, { whatsapp_account_id: null });
        }
      }
    }
    if (await tableExists(queryInterface, 'auto_replies')) {
      const indexes = await queryInterface.showIndex('auto_replies').catch(() => []);
      for (const index of indexes) {
        const fields = (index.fields || []).map((field) => field.attribute || field.name);
        if (index.unique && fields.length === 1 && fields[0] === 'trigger') {
          await queryInterface.removeIndex('auto_replies', index.name).catch(() => null);
        }
      }
      const refreshed = await queryInterface.showIndex('auto_replies').catch(() => []);
      if (!refreshed.some((index) => index.name === 'auto_replies_trigger_account_unique')) {
        await queryInterface.addIndex('auto_replies', ['trigger', 'whatsapp_account_id'], {
          unique: true,
          name: 'auto_replies_trigger_account_unique'
        });
      }
    }
  },

  async down(queryInterface) {
    const accountTables = [
      'conversations', 'messages', 'contacts', 'leads', 'whatsapp_templates', 'campaigns',
      'campaign_recipients', 'message_queue', 'flows', 'flow_runs', 'auto_replies', 'whatsapp_compliance_logs'
    ];
    for (const table of accountTables) {
      if (await columnExists(queryInterface, table, 'whatsapp_account_id')) await queryInterface.removeColumn(table, 'whatsapp_account_id');
    }
    if (await tableExists(queryInterface, 'whatsapp_accounts')) await queryInterface.dropTable('whatsapp_accounts');
  }
};
