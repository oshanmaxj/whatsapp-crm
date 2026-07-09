const axios = require('axios');
const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  sequelize, WhatsAppAccount, Conversation, Message, Contact, Lead, WhatsAppTemplate,
  Campaign, CampaignRecipient, MessageQueue, Flow, FlowRun, AutoReply, WhatsAppComplianceLog
} = require('../models');
const whatsappSettingsService = require('./whatsappSettings.service');
const whatsappAccountAccessService = require('./whatsappAccountAccess.service');

function encryptionKey() {
  const source = process.env.APP_SETTINGS_ENCRYPTION_KEY || process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET || '';
  return crypto.createHash('sha256').update(source).digest();
}

function encrypt(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `enc:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function decrypt(value) {
  if (!value || !String(value).startsWith('enc:')) return value || '';
  const [, iv, tag, encrypted] = String(value).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}

function mask(value) {
  const text = String(value || '');
  return text ? `${text.slice(0, 4)}****${text.slice(-4)}` : '';
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function envValue(name, fallback = '') {
  const value = process.env[name];
  if (value == null) return fallback;
  return clean(value);
}

function serialize(row) {
  const data = row?.toJSON ? row.toJSON() : row;
  if (!data) return null;
  delete data.accessTokenEncrypted;
  delete data.appSecretEncrypted;
  return {
    ...data,
    connectionStatus: data.connectionStatus || data.status || 'connected',
    accessToken: mask(decrypt(row.accessTokenEncrypted)),
    appSecret: mask(decrypt(row.appSecretEncrypted))
  };
}

class WhatsAppAccountService {
  async backfillUnassigned(accountId) {
    const models = [Conversation, Message, Contact, Lead, WhatsAppTemplate, Campaign, CampaignRecipient, MessageQueue, Flow, FlowRun, AutoReply, WhatsAppComplianceLog];
    await Promise.all(models.map((model) => model?.rawAttributes?.whatsappAccountId
      ? model.update({ whatsappAccountId: accountId }, { where: { whatsappAccountId: null } })
      : null));
  }

  async ensureDefault() {
    let account = await WhatsAppAccount.findOne({ where: { isDefault: true, status: 'active' } });
    if (account) return account;
    account = await WhatsAppAccount.findOne({ where: { status: 'active' }, order: [['id', 'ASC']] });
    if (account) {
      await account.update({ isDefault: true });
      return account;
    }
    const legacy = await whatsappSettingsService.getRaw().catch(() => ({}));
    const phoneNumberId = clean(legacy.phoneNumberId) || envValue('WHATSAPP_PHONE_NUMBER_ID');
    const accessToken = envValue('WHATSAPP_ACCESS_TOKEN') || clean(legacy.accessToken);
    if (!phoneNumberId || !accessToken) return null;
    account = await WhatsAppAccount.create({
      name: legacy.phoneNumber || 'Default WhatsApp Number',
      phoneNumber: legacy.phoneNumber || null,
      phoneNumberId,
      businessAccountId: clean(legacy.businessAccountId) || envValue('WHATSAPP_BUSINESS_ACCOUNT_ID') || null,
      accessTokenEncrypted: encrypt(accessToken),
      webhookVerifyToken: clean(legacy.verifyToken) || envValue('WHATSAPP_VERIFY_TOKEN') || null,
      appId: legacy.appId || null,
      appSecretEncrypted: legacy.appSecret ? encrypt(legacy.appSecret) : null,
      apiVersion: clean(legacy.apiVersion) || envValue('WHATSAPP_API_VERSION', 'v17.0'),
      apiBaseUrl: clean(legacy.apiBaseUrl) || envValue('WHATSAPP_API_BASE_URL', 'https://graph.facebook.com'),
      status: 'active',
      isDefault: true
    });
    await this.backfillUnassigned(account.id);
    return account;
  }

  async list({ includeInactive = false, userId = null } = {}) {
    await this.ensureDefault();
    const accessWhere = userId ? await whatsappAccountAccessService.whereForUser(userId, 'id') : {};
    const rows = await WhatsAppAccount.findAll({
      where: { ...(includeInactive ? {} : { status: 'active' }), ...accessWhere },
      order: [['is_default', 'DESC'], ['name', 'ASC']]
    });
    const stats = await Promise.all(rows.map(async (row) => {
      const [templates, campaigns, flows, conversations] = await Promise.all([
        WhatsAppTemplate.count({ where: { whatsappAccountId: row.id } }),
        Campaign.count({ where: { whatsappAccountId: row.id } }),
        Flow.count({ where: { whatsappAccountId: row.id } }),
        Conversation.count({ where: { whatsappAccountId: row.id } })
      ]);
      return { templates, campaigns, flows, conversations };
    }));
    return rows.map((row, index) => ({ ...serialize(row), statistics: stats[index] }));
  }

  async get(id) {
    const row = await WhatsAppAccount.findByPk(id);
    if (!row) throw Object.assign(new Error('WhatsApp account not found'), { status: 404 });
    return row;
  }

  async getPublic(id, userId = null) {
    if (userId) await whatsappAccountAccessService.assertAccess(id, userId);
    return serialize(await this.get(id));
  }

  async runtimeConfig(id = null, { phoneNumberId = null } = {}) {
    let row;
    if (id) row = await WhatsAppAccount.findByPk(id);
    else if (phoneNumberId) row = await WhatsAppAccount.findOne({ where: { phoneNumberId } });
    else row = await this.ensureDefault();
    if (!row && (id || phoneNumberId)) throw Object.assign(new Error('WhatsApp account not found'), { status: 404 });
    if (!row) return null;
    if (row.status !== 'active') throw Object.assign(new Error('WhatsApp account is inactive'), { status: 409 });
    return {
      whatsappAccountId: row.id,
      name: row.name,
      phoneNumber: row.phoneNumber,
      phoneNumberId: clean(row.phoneNumberId),
      businessAccountId: clean(row.businessAccountId),
      accessToken: envValue('WHATSAPP_ACCESS_TOKEN') || clean(decrypt(row.accessTokenEncrypted)),
      verifyToken: clean(row.webhookVerifyToken),
      appId: row.appId,
      appSecret: decrypt(row.appSecretEncrypted),
      apiVersion: clean(row.apiVersion) || envValue('WHATSAPP_API_VERSION', 'v17.0'),
      apiBaseUrl: clean(row.apiBaseUrl) || envValue('WHATSAPP_API_BASE_URL', 'https://graph.facebook.com'),
      status: row.status,
      isDefault: row.isDefault
    };
  }

  async create(payload, userId) {
    const duplicate = await WhatsAppAccount.findOne({ where: { phoneNumberId: String(payload.phoneNumberId || '').trim() } });
    if (duplicate) throw Object.assign(new Error('Phone number ID is already connected'), { status: 409 });
    return sequelize.transaction(async (transaction) => {
      const existingCount = await WhatsAppAccount.count({ transaction });
      const isDefault = payload.isDefault === true || existingCount === 0;
      if (isDefault) await WhatsAppAccount.update({ isDefault: false }, { where: {}, transaction });
      const row = await WhatsAppAccount.create({
        name: String(payload.name || '').trim(),
        phoneNumber: payload.phoneNumber || null,
        phoneNumberId: String(payload.phoneNumberId || '').trim(),
        businessAccountId: payload.businessAccountId || null,
        accessTokenEncrypted: encrypt(payload.accessToken),
        webhookVerifyToken: payload.webhookVerifyToken || payload.verifyToken || null,
        appId: payload.appId || null,
        appSecretEncrypted: payload.appSecret ? encrypt(payload.appSecret) : null,
        apiVersion: payload.apiVersion || process.env.WHATSAPP_API_VERSION || 'v17.0',
        apiBaseUrl: payload.apiBaseUrl || process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com',
        status: payload.status || 'active',
        isDefault,
        createdBy: userId || null
      }, { transaction });
      return serialize(row);
    });
  }

  async update(id, payload) {
    const row = await this.get(id);
    if (payload.phoneNumberId && payload.phoneNumberId !== row.phoneNumberId) {
      const duplicate = await WhatsAppAccount.findOne({ where: { phoneNumberId: payload.phoneNumberId, id: { [Op.ne]: row.id } } });
      if (duplicate) throw Object.assign(new Error('Phone number ID is already connected'), { status: 409 });
    }
    if (payload.status === 'inactive' && row.isDefault) {
      throw Object.assign(new Error('Set another active account as default before deactivating this account'), { status: 409 });
    }
    await row.update({
      name: payload.name ?? row.name,
      phoneNumber: payload.phoneNumber ?? row.phoneNumber,
      phoneNumberId: payload.phoneNumberId ?? row.phoneNumberId,
      businessAccountId: payload.businessAccountId ?? row.businessAccountId,
      accessTokenEncrypted: payload.accessToken ? encrypt(payload.accessToken) : row.accessTokenEncrypted,
      webhookVerifyToken: payload.webhookVerifyToken ?? payload.verifyToken ?? row.webhookVerifyToken,
      appId: payload.appId ?? row.appId,
      appSecretEncrypted: payload.appSecret ? encrypt(payload.appSecret) : row.appSecretEncrypted,
      apiVersion: payload.apiVersion ?? row.apiVersion,
      apiBaseUrl: payload.apiBaseUrl ?? row.apiBaseUrl,
      status: payload.status ?? row.status
    });
    return serialize(row);
  }

  async setDefault(id) {
    const row = await this.get(id);
    if (row.status !== 'active') throw Object.assign(new Error('Only an active account can be the default'), { status: 409 });
    await sequelize.transaction(async (transaction) => {
      await WhatsAppAccount.update({ isDefault: false }, { where: { id: { [Op.ne]: row.id } }, transaction });
      await row.update({ isDefault: true }, { transaction });
    });
    return serialize(row);
  }

  async deactivate(id) {
    return this.update(id, { status: 'inactive' });
  }

  async testConnection(id) {
    const row = await this.get(id);
    const config = await this.runtimeConfig(id);
    try {
      const response = await axios.get(`${config.apiBaseUrl}/${config.apiVersion}/${config.phoneNumberId}`, {
        params: { fields: 'id,display_phone_number,verified_name' },
        headers: { Authorization: `Bearer ${config.accessToken}` },
        timeout: 15000
      });
      await row.update({ lastTestedAt: new Date(), phoneNumber: response.data?.display_phone_number || row.phoneNumber });
      await row.update({ connectionStatus: 'connected', connectionError: null });
      return { connected: true, ...response.data };
    } catch (error) {
      await row.update({
        lastTestedAt: new Date(),
        connectionStatus: 'disconnected',
        connectionError: error.response?.data?.error?.message || error.message
      });
      throw Object.assign(new Error('WhatsApp connection test failed'), {
        status: error.response?.status === 401 ? 401 : 502,
        details: error.response?.data || error.message
      });
    }
  }

  async historyCount(id) {
    const models = [Conversation, Message, Contact, Lead, WhatsAppTemplate, Campaign, CampaignRecipient, MessageQueue, Flow, FlowRun, AutoReply, WhatsAppComplianceLog];
    const counts = await Promise.all(models.map((model) => model?.rawAttributes?.whatsappAccountId
      ? model.count({ where: { whatsappAccountId: id } })
      : 0));
    return counts.reduce((sum, value) => sum + value, 0);
  }
}

module.exports = new WhatsAppAccountService();
module.exports.encrypt = encrypt;
module.exports.decrypt = decrypt;
