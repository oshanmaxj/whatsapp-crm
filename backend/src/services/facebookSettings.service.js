const axios = require('axios');
const crypto = require('crypto');
const { AppSetting } = require('../models');
const auditService = require('./audit.service');

const NAMESPACE = 'facebook';
const KEY = 'app_config';
const GRAPH_API_BASE_URL = 'https://graph.facebook.com';
const CALLBACK_PATH = '/api/webhooks/facebook';

function envValue(name, fallback = '') {
  const value = process.env[name];
  if (value == null) return fallback;
  return String(value).trim();
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

function encryptionKey() {
  const source = process.env.APP_SETTINGS_ENCRYPTION_KEY || process.env.JWT_REFRESH_SECRET || process.env.JWT_ACCESS_SECRET || '';
  return crypto.createHash('sha256').update(source).digest();
}

function encryptSecret(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `enc:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('enc:')) return value || '';
  const [, iv, tag, encrypted] = value.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
}

function callbackUrl() {
  const base = envValue('FACEBOOK_WEBHOOK_BASE_URL', 'https://api.firstofsolutions.com').replace(/\/$/, '');
  return `${base}${CALLBACK_PATH}`;
}

function envDefaults() {
  return {
    appId: envValue('FACEBOOK_APP_ID'),
    appSecret: envValue('FACEBOOK_APP_SECRET'),
    webhookVerifyToken: envValue('FACEBOOK_WEBHOOK_VERIFY_TOKEN'),
    graphApiVersion: envValue('FACEBOOK_GRAPH_API_VERSION', 'v21.0')
  };
}

class FacebookSettingsService {
  async row() {
    const [row] = await AppSetting.findOrCreate({
      where: { namespace: NAMESPACE, key: KEY },
      defaults: { value: {}, isSecret: true }
    });
    return row;
  }

  // Centralized resolver — every other Facebook module (webhook controller,
  // page/messenger/comment services) must call this instead of reading
  // process.env directly. Precedence, recomputed on every call: a configured
  // admin-settings value always wins; an empty/never-configured field falls
  // back to the environment variable. This keeps FACEBOOK_APP_SECRET /
  // FACEBOOK_WEBHOOK_VERIFY_TOKEN working as an emergency-recovery fallback
  // even after the admin UI has been used, and lets the UI be used even if
  // no env vars were ever set.
  async getRuntimeConfig() {
    const row = await this.row();
    const stored = row.value || {};
    const storedAppSecret = clean(decryptSecret(stored.appSecret));
    const storedVerifyToken = clean(decryptSecret(stored.webhookVerifyToken));
    const env = envDefaults();
    return {
      appId: clean(stored.appId) || env.appId,
      appSecret: storedAppSecret || env.appSecret,
      webhookVerifyToken: storedVerifyToken || env.webhookVerifyToken,
      graphApiVersion: clean(stored.graphApiVersion) || env.graphApiVersion,
      appSecretSource: storedAppSecret ? 'settings' : (env.appSecret ? 'env' : 'none'),
      verifyTokenSource: storedVerifyToken ? 'settings' : (env.webhookVerifyToken ? 'env' : 'none')
    };
  }

  async getPublicMetadata() {
    const config = await this.getRuntimeConfig();
    return {
      appId: config.appId || '',
      appSecretConfigured: Boolean(config.appSecret),
      webhookVerifyTokenConfigured: Boolean(config.webhookVerifyToken),
      graphApiVersion: config.graphApiVersion,
      callbackUrl: callbackUrl(),
      webhookEndpointAvailable: true
    };
  }

  async save(payload = {}, userId = null) {
    const row = await this.row();
    const current = row.value || {};
    const appIdChanged = payload.appId !== undefined && clean(payload.appId) !== clean(current.appId);
    const appSecretChanged = Boolean(clean(payload.appSecret));
    const verifyTokenChanged = Boolean(clean(payload.webhookVerifyToken));
    const graphApiVersionChanged = payload.graphApiVersion !== undefined && clean(payload.graphApiVersion) !== clean(current.graphApiVersion);

    const next = {
      ...current,
      appId: payload.appId !== undefined ? clean(payload.appId) : (current.appId || ''),
      // Blank input keeps the existing encrypted value untouched — never
      // overwrite a real secret with an empty string just because the admin
      // left the field blank on an unrelated save.
      appSecret: appSecretChanged ? encryptSecret(payload.appSecret) : (current.appSecret || ''),
      webhookVerifyToken: verifyTokenChanged ? encryptSecret(payload.webhookVerifyToken) : (current.webhookVerifyToken || ''),
      graphApiVersion: payload.graphApiVersion !== undefined ? clean(payload.graphApiVersion) : (current.graphApiVersion || '')
    };

    await row.update({ value: next, updatedBy: userId || null });

    await auditService.record({
      userId,
      action: 'facebook_settings_updated',
      entityType: 'facebook_settings',
      entityId: String(row.id),
      changes: { appIdChanged, appSecretChanged, verifyTokenChanged, graphApiVersionChanged }
    });
    if (appSecretChanged) {
      await auditService.record({
        userId,
        action: 'facebook_app_secret_replaced',
        entityType: 'facebook_settings',
        entityId: String(row.id),
        changes: { appSecretChanged: true }
      });
    }

    return this.getPublicMetadata();
  }

  // The only place a plaintext token is ever returned. Once this response is
  // read, the token cannot be retrieved again — GET only ever reports
  // "configured: true/false".
  async generateVerifyToken(userId = null) {
    const token = crypto.randomBytes(32).toString('hex');
    const row = await this.row();
    const current = row.value || {};
    await row.update({ value: { ...current, webhookVerifyToken: encryptSecret(token) }, updatedBy: userId || null });

    await auditService.record({
      userId,
      action: 'facebook_verify_token_generated',
      entityType: 'facebook_settings',
      entityId: String(row.id),
      changes: { verifyTokenChanged: true }
    });

    return { verifyToken: token, webhookVerifyTokenConfigured: true };
  }

  async testConfiguration() {
    const config = await this.getRuntimeConfig();
    const checks = {
      appId: Boolean(config.appId),
      appSecret: Boolean(config.appSecret),
      verifyToken: Boolean(config.webhookVerifyToken),
      webhookEndpoint: true
    };
    const result = { success: Object.values(checks).every(Boolean), checks };

    if (config.appId && config.appSecret) {
      try {
        await axios.get(`${GRAPH_API_BASE_URL}/oauth/access_token`, {
          params: { client_id: config.appId, client_secret: config.appSecret, grant_type: 'client_credentials' },
          timeout: 10000
        });
        result.metaValidated = true;
      } catch (error) {
        result.metaValidated = false;
        result.success = false;
        result.reason = error.response?.data?.error?.type === 'OAuthException'
          ? 'Meta rejected the App ID / App Secret pair.'
          : 'Unable to reach Meta to validate credentials.';
      }
    }

    return result;
  }
}

module.exports = new FacebookSettingsService();
module.exports.callbackUrl = callbackUrl;
