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

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function envValue(name, fallback = '') {
  const value = process.env[name];
  if (value == null) return fallback;
  return clean(value);
}

function validateAccountFields(payload, { requireToken = false } = {}) {
  const phoneNumberId = clean(payload.phoneNumberId);
  if (phoneNumberId && !/^\d+$/.test(phoneNumberId)) {
    throw Object.assign(new Error('Phone number ID must contain digits only.'), { status: 400, code: 'WHATSAPP_CONFIGURATION_INVALID' });
  }
  if (requireToken && !clean(payload.accessToken)) {
    throw Object.assign(new Error('Access token is required.'), { status: 400, code: 'WHATSAPP_CONFIGURATION_INVALID' });
  }
  const apiVersion = clean(payload.apiVersion);
  if (apiVersion && !/^v\d+\.\d+$/.test(apiVersion)) {
    throw Object.assign(new Error('Graph API version must use the format vNN.N.'), { status: 400, code: 'WHATSAPP_CONFIGURATION_INVALID' });
  }
}

function serialize(row) {
  const data = row?.toJSON ? row.toJSON() : row;
  if (!data) return null;
  delete data.accessTokenEncrypted;
  delete data.appSecretEncrypted;
  delete data.webhookVerifyToken;
  return {
    ...data,
    connectionStatus: data.connectionStatus || data.status || 'connected',
    accessTokenConfigured: Boolean(row.accessTokenEncrypted),
    appSecretConfigured: Boolean(row.appSecretEncrypted),
    webhookVerifyTokenConfigured: Boolean(row.webhookVerifyToken)
  };
}

function lastFour(value) {
  const text = clean(value);
  return text ? text.slice(-4) : null;
}

const CRM_WEBHOOK_URL = 'https://api.firstofsolutions.com/api/webhooks/whatsapp';

function graphFailure(error, fallback) {
  const meta = error.response?.data?.error || {};
  return Object.assign(new Error(fallback), {
    status: error.response?.status === 401 ? 401 : 502,
    code: 'WHATSAPP_WEBHOOK_SUBSCRIPTION_FAILED',
    metaCode: meta.code == null ? null : String(meta.code),
    metaSubcode: meta.error_subcode == null ? null : String(meta.error_subcode),
    exposeMessage: true
  });
}

function subscriptionAppId(item) {
  return clean(item?.whatsapp_business_api_data?.id || item?.app_id || item?.id);
}

function subscriptionOverride(item) {
  return clean(item?.override_callback_uri || item?.callback_url);
}

class WhatsAppAccountService {
  async graphRequest(config, method, objectId, edge = '', data = undefined) {
    return axios.request({
      method,
      url: `${config.apiBaseUrl}/${config.apiVersion}/${objectId}${edge}`,
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json'
      },
      ...(data === undefined ? {} : { data }),
      timeout: 15000
    });
  }

  validateWebhookConfig(config, { requireVerifyToken = false } = {}) {
    if (!/^\d+$/.test(config.businessAccountId || '')) {
      throw Object.assign(new Error('A numeric WABA ID is required for webhook subscription management.'), { status: 400, code: 'WHATSAPP_WABA_ID_REQUIRED' });
    }
    if (!/^\d+$/.test(config.phoneNumberId || '') || !config.accessToken) {
      throw Object.assign(new Error('The selected WhatsApp account credentials are incomplete.'), { status: 400, code: 'WHATSAPP_CONFIGURATION_INVALID' });
    }
    if (!/^\d+$/.test(clean(config.appId))) {
      throw Object.assign(new Error('A numeric CRM Meta App ID is required to confirm the subscription.'), { status: 400, code: 'WHATSAPP_APP_ID_REQUIRED' });
    }
    if (requireVerifyToken && !config.verifyToken) {
      throw Object.assign(new Error('A webhook verify token is required to override the callback.'), { status: 400, code: 'WHATSAPP_VERIFY_TOKEN_REQUIRED' });
    }
  }

  async fetchSubscriptions(config) {
    try {
      const response = await this.graphRequest(config, 'get', config.businessAccountId, '/subscribed_apps');
      return Array.isArray(response.data?.data) ? response.data.data : [];
    } catch (error) {
      throw graphFailure(error, 'Unable to check the WABA webhook subscription.');
    }
  }

  async verifySelectedPhone(config) {
    try {
      const response = await this.graphRequest(config, 'get', config.phoneNumberId);
      return clean(response.data?.id) === clean(config.phoneNumberId);
    } catch (error) {
      return false;
    }
  }

  diagnosticFrom(config, subscriptions, phoneVerified) {
    const appSubscription = subscriptions.find((item) => subscriptionAppId(item) === clean(config.appId));
    const overrides = subscriptions.map(subscriptionOverride).filter(Boolean);
    const crmOverride = subscriptionOverride(appSubscription);
    const whatChimpOverride = overrides.some((url) => /whatchimp/i.test(url));
    const mismatchedOverride = Boolean(crmOverride && crmOverride !== CRM_WEBHOOK_URL);
    const subscribed = Boolean(appSubscription);
    let connectionVerificationResult = 'verified';
    if (!phoneVerified) connectionVerificationResult = 'selected phone number verification failed';
    else if (!subscribed) connectionVerificationResult = 'CRM app is not subscribed';
    else if (whatChimpOverride) connectionVerificationResult = 'warning: WhatChimp callback override detected';
    else if (mismatchedOverride) connectionVerificationResult = 'warning: callback override does not use the CRM webhook';
    return {
      wabaIdLastFour: lastFour(config.businessAccountId),
      phoneNumberIdLastFour: lastFour(config.phoneNumberId),
      crmAppId: clean(config.appId),
      subscribed,
      callbackSource: overrides.length ? 'override' : 'app default',
      connectionVerificationResult
    };
  }

  async checkWebhookSubscription(id, userId = null) {
    if (userId) await whatsappAccountAccessService.assertAccess(id, userId);
    const config = await this.runtimeConfig(id);
    this.validateWebhookConfig(config);
    const subscriptions = await this.fetchSubscriptions(config);
    const phoneVerified = await this.verifySelectedPhone(config);
    return this.diagnosticFrom(config, subscriptions, phoneVerified);
  }

  async subscribeWebhook(id, userId = null) {
    if (userId) await whatsappAccountAccessService.assertAccess(id, userId);
    const config = await this.runtimeConfig(id);
    this.validateWebhookConfig(config);
    let subscriptions = await this.fetchSubscriptions(config);
    if (!subscriptions.some((item) => subscriptionAppId(item) === clean(config.appId))) {
      try {
        await this.graphRequest(config, 'post', config.businessAccountId, '/subscribed_apps', {});
      } catch (error) {
        throw graphFailure(error, 'Unable to subscribe the CRM app to the WABA webhook.');
      }
      subscriptions = await this.fetchSubscriptions(config);
      if (!subscriptions.some((item) => subscriptionAppId(item) === clean(config.appId))) {
        throw Object.assign(new Error('Meta did not confirm the CRM app in the WABA subscriptions.'), { status: 502, code: 'WHATSAPP_SUBSCRIPTION_NOT_CONFIRMED', exposeMessage: true });
      }
    }
    return this.diagnosticFrom(config, subscriptions, await this.verifySelectedPhone(config));
  }

  async overrideWebhookCallback(id, userId = null) {
    if (userId) await whatsappAccountAccessService.assertAccess(id, userId);
    const config = await this.runtimeConfig(id);
    this.validateWebhookConfig(config, { requireVerifyToken: true });
    let subscriptions = await this.fetchSubscriptions(config);
    if (!subscriptions.some((item) => subscriptionAppId(item) === clean(config.appId))) {
      try {
        await this.graphRequest(config, 'post', config.businessAccountId, '/subscribed_apps', {});
      } catch (error) {
        throw graphFailure(error, 'Unable to subscribe the CRM app before overriding its callback.');
      }
    }
    try {
      await this.graphRequest(config, 'post', config.businessAccountId, '/subscribed_apps', {
        override_callback_uri: CRM_WEBHOOK_URL,
        verify_token: config.verifyToken
      });
    } catch (error) {
      throw graphFailure(error, 'Unable to override the WABA callback URL.');
    }
    subscriptions = await this.fetchSubscriptions(config);
    const appSubscription = subscriptions.find((item) => subscriptionAppId(item) === clean(config.appId));
    if (!appSubscription || subscriptionOverride(appSubscription) !== CRM_WEBHOOK_URL) {
      throw Object.assign(new Error('Meta did not confirm the CRM webhook callback override.'), { status: 502, code: 'WHATSAPP_CALLBACK_NOT_CONFIRMED', exposeMessage: true });
    }
    return this.diagnosticFrom(config, subscriptions, await this.verifySelectedPhone(config));
  }

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
      // A database account is an atomic credential set. Never combine its ID
      // with a global token that may belong to a different Meta business.
      accessToken: clean(decrypt(row.accessTokenEncrypted)),
      verifyToken: clean(row.webhookVerifyToken),
      appId: row.appId,
      appSecret: decrypt(row.appSecretEncrypted),
      apiVersion: clean(row.apiVersion) || envValue('WHATSAPP_API_VERSION', 'v17.0'),
      apiBaseUrl: clean(row.apiBaseUrl) || envValue('WHATSAPP_API_BASE_URL', 'https://graph.facebook.com'),
      status: row.status,
      isDefault: row.isDefault,
      connectionStatus: row.connectionStatus,
      sendEnabled: row.sendEnabled !== false,
      configurationSource: 'whatsapp_account'
    };
  }

  async safeDiagnostic(id = null) {
    const config = await this.runtimeConfig(id);
    return {
      configurationSource: config.configurationSource,
      whatsappAccountId: config.whatsappAccountId,
      phoneNumberIdLastFour: lastFour(config.phoneNumberId),
      graphApiVersion: config.apiVersion,
      tokenExists: Boolean(config.accessToken),
      active: config.status === 'active',
      sendEnabled: config.sendEnabled && config.connectionStatus !== 'disconnected'
    };
  }

  async create(payload, userId) {
    validateAccountFields(payload, { requireToken: true });
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
    validateAccountFields(payload);
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
        params: { fields: 'id,display_phone_number,verified_name,quality_rating' },
        headers: { Authorization: `Bearer ${config.accessToken}` },
        timeout: 15000
      });
      const verifiedAt = new Date();
      await row.update({
        lastTestedAt: verifiedAt,
        lastVerifiedAt: verifiedAt,
        phoneNumber: response.data?.display_phone_number || row.phoneNumber,
        verifiedName: response.data?.verified_name || row.verifiedName,
        qualityRating: response.data?.quality_rating || row.qualityRating,
        connectionStatus: 'connected',
        connectionError: null
      });
      return { connected: true, ...response.data };
    } catch (error) {
      const meta = error.response?.data?.error || {};
      const inaccessible = Number(meta.code) === 100 && Number(meta.error_subcode) === 33;
      const message = inaccessible
        ? 'Configured phone number ID is not accessible with the configured token.'
        : 'WhatsApp connection verification failed.';
      await row.update({
        lastTestedAt: new Date(),
        connectionStatus: 'disconnected',
        connectionError: message
      });
      throw Object.assign(new Error(message), {
        status: error.response?.status === 401 ? 401 : 502,
        code: inaccessible ? 'WHATSAPP_PHONE_NUMBER_INACCESSIBLE' : 'WHATSAPP_CONNECTION_FAILED',
        metaCode: meta.code == null ? null : String(meta.code),
        metaSubcode: meta.error_subcode == null ? null : String(meta.error_subcode),
        exposeMessage: true
      });
    }
  }

  async markDisconnected(id, message) {
    if (!id) return;
    await WhatsAppAccount.update({ connectionStatus: 'disconnected', connectionError: message, lastTestedAt: new Date() }, { where: { id } });
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
