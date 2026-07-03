const axios = require('axios');
const crypto = require('crypto');
const { AppSetting } = require('../models');

const NAMESPACE = 'whatsapp';
const KEY = 'cloud_api';
const SECRET_FIELDS = ['accessToken', 'appSecret'];

function encryptionKey() {
  const source = process.env.APP_SETTINGS_ENCRYPTION_KEY || process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET || '';
  return crypto.createHash('sha256').update(source).digest();
}

function encryptSecret(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (!value || typeof value !== 'string') return '';
  if (!value.startsWith('enc:')) return value;

  const [, iv, tag, encrypted] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

function maskSecret(value) {
  if (!value) return '';
  const visible = String(value);
  if (visible.length <= 8) return '****';
  return `${visible.slice(0, 4)}****${visible.slice(-4)}`;
}

function defaults() {
  return {
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || '',
    appId: process.env.WHATSAPP_APP_ID || '',
    appSecret: process.env.WHATSAPP_APP_SECRET || '',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v17.0',
    apiBaseUrl: process.env.WHATSAPP_API_BASE_URL || 'https://graph.facebook.com',
    webhookUrl: process.env.WHATSAPP_WEBHOOK_URL || 'http://localhost:4000/api/webhooks/whatsapp',
    status: 'Not Connected',
    lastTestedAt: null,
    webhookVerifiedAt: null,
    sendEnabled: process.env.WHATSAPP_SEND_ENABLED === 'true'
  };
}

function storedDefaults() {
  const values = defaults();
  SECRET_FIELDS.forEach((field) => {
    values[field] = encryptSecret(values[field]);
  });
  return values;
}

function decryptSettings(value = {}) {
  const resolved = { ...defaults(), ...value };
  SECRET_FIELDS.forEach((field) => {
    resolved[field] = decryptSecret(resolved[field]);
  });
  return resolved;
}

function serialize(settings, { includeSecrets = false } = {}) {
  return {
    businessAccountId: settings.businessAccountId || '',
    phoneNumberId: settings.phoneNumberId || '',
    accessToken: includeSecrets ? settings.accessToken || '' : maskSecret(settings.accessToken),
    verifyToken: settings.verifyToken || '',
    appId: settings.appId || '',
    appSecret: includeSecrets ? settings.appSecret || '' : maskSecret(settings.appSecret),
    apiVersion: settings.apiVersion || 'v17.0',
    apiBaseUrl: settings.apiBaseUrl || 'https://graph.facebook.com',
    webhookUrl: settings.webhookUrl || 'http://localhost:4000/api/webhooks/whatsapp',
    status: settings.status || 'Not Connected',
    lastTestedAt: settings.lastTestedAt || null,
    webhookVerifiedAt: settings.webhookVerifiedAt || null,
    sendEnabled: settings.sendEnabled === true
  };
}

class WhatsappSettingsService {
  async row() {
    const [row] = await AppSetting.findOrCreate({
      where: { namespace: NAMESPACE, key: KEY },
      defaults: { value: storedDefaults() }
    });
    return row;
  }

  async getRaw() {
    const row = await this.row();
    return decryptSettings(row.value || {});
  }

  async getPublic() {
    return serialize(await this.getRaw());
  }

  async save(payload = {}, userId = null) {
    const row = await this.row();
    const current = decryptSettings(row.value || {});
    const next = {
      ...current,
      businessAccountId: payload.businessAccountId ?? current.businessAccountId,
      phoneNumberId: payload.phoneNumberId ?? current.phoneNumberId,
      accessToken: payload.accessToken ? encryptSecret(payload.accessToken) : row.value?.accessToken || '',
      verifyToken: payload.verifyToken ?? current.verifyToken,
      appId: payload.appId ?? current.appId,
      appSecret: payload.appSecret ? encryptSecret(payload.appSecret) : row.value?.appSecret || '',
      apiVersion: payload.apiVersion ?? current.apiVersion,
      apiBaseUrl: payload.apiBaseUrl ?? current.apiBaseUrl,
      webhookUrl: payload.webhookUrl ?? current.webhookUrl,
      sendEnabled: process.env.WHATSAPP_SEND_ENABLED === 'true'
    };

    await row.update({ value: next, updatedBy: userId || null });
    return this.getPublic();
  }

  async markWebhookVerified() {
    const row = await this.row();
    const current = decryptSettings(row.value || {});
    await row.update({
      value: {
        ...(row.value || {}),
        status: 'Webhook Verified',
        webhookVerifiedAt: new Date().toISOString()
      }
    });
    return { ...current, status: 'Webhook Verified', webhookVerifiedAt: new Date().toISOString() };
  }

  async runtimeConfig() {
    const row = await this.row();
    const stored = row.value || {};
    const resolved = decryptSettings(stored);
    return {
      ...resolved,
      tokenSource: stored.accessToken ? 'settings' : 'env',
      phoneNumberIdSource: stored.phoneNumberId ? 'settings' : 'env'
    };
  }

  async testConnection() {
    const settings = await this.getRaw();
    if (!settings.accessToken || !settings.phoneNumberId) {
      const error = new Error('Access token and phone number ID are required');
      error.status = 400;
      throw error;
    }

    try {
      const baseUrl = `${settings.apiBaseUrl}/${settings.apiVersion}/${settings.phoneNumberId}`;
      const response = await axios.get(baseUrl, {
        params: { fields: 'id,display_phone_number,verified_name' },
        headers: { Authorization: `Bearer ${settings.accessToken}` },
        timeout: 15000
      });

      const row = await this.row();
      await row.update({
        value: {
          ...(row.value || {}),
          status: 'Connected',
          lastTestedAt: new Date().toISOString()
        }
      });

      return {
        status: 'Connected',
        phoneNumber: response.data?.display_phone_number || null,
        verifiedName: response.data?.verified_name || null,
        id: response.data?.id || null
      };
    } catch (error) {
      const row = await this.row();
      await row.update({
        value: {
          ...(row.value || {}),
          status: 'Token Invalid',
          lastTestedAt: new Date().toISOString()
        }
      });
      const err = new Error('WhatsApp connection test failed');
      err.status = error.response?.status === 401 ? 401 : 502;
      err.details = error.response?.data || error.message;
      throw err;
    }
  }

  async testSend({ to, message }) {
    if (process.env.WHATSAPP_SEND_ENABLED !== 'true') {
      return {
        simulated: true,
        status: 'Not Connected',
        message: 'WHATSAPP_SEND_ENABLED is false. Test send was simulated.'
      };
    }

    const whatsappService = require('./whatsapp.service');
    const result = await whatsappService.sendTextMessage({
      to,
      text: message || 'First Of Education International WhatsApp connection test',
      log: false
    });

    return {
      simulated: false,
      status: 'Connected',
      result
    };
  }
}

module.exports = new WhatsappSettingsService();
