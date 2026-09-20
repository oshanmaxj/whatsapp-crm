const crypto = require('crypto');
const { AppSetting } = require('../models');
const auditService = require('./audit.service');
const factory = require('./sms/smsProviderFactory');

const NAMESPACE = 'sms_gateway';
const KEY = 'config';
const DEFAULT_PROVIDER = 'smsgo';
const WEBHOOK_PATH = '/api/webhooks/sms';

// Reuses the same "our own public HTTPS origin" env var facebookSettings.service.js
// already established for exactly this purpose, rather than introducing a
// second env var that means the same thing. The path itself is generic —
// one endpoint serves whichever provider is active (see smsWebhook.controller.js).
function publicBaseUrl() {
  const value = process.env.FACEBOOK_WEBHOOK_BASE_URL || 'https://api.firstofsolutions.com';
  return String(value).trim().replace(/\/$/, '');
}

function clean(value) {
  return value == null ? '' : String(value).trim();
}

// Same encryption-key resolution and enc:iv:tag:cipher envelope already used
// by facebookSettings.service.js — reused here rather than introduced
// fresh, so SMS gateway secrets rotate under the same
// APP_SETTINGS_ENCRYPTION_KEY. This part is provider-agnostic: it encrypts
// whichever fields a provider's registry entry marks as secret, without
// knowing what those fields mean.
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

function notConfigured(providerName) {
  return Object.assign(new Error(`The ${providerName} SMS provider is not configured.`), {
    status: 409, code: 'SMS_PROVIDER_NOT_CONFIGURED', exposeMessage: true
  });
}

class SmsGatewaySettingsService {
  async row() {
    const [row] = await AppSetting.findOrCreate({
      where: { namespace: NAMESPACE, key: KEY },
      defaults: { value: {}, isSecret: true }
    });
    return row;
  }

  // Centralized resolver — the generic sms.service.js facade (and this
  // service's own test/masks/balance actions) call this instead of reading
  // AppSetting directly. Returns the active provider's config with its
  // secret fields decrypted; which fields exist and which are secret comes
  // from that provider's registry descriptor, not from anything SMS
  // Gateway settings hardcodes.
  async getRuntimeConfig() {
    const row = await this.row();
    const stored = row.value || {};
    const activeProvider = stored.activeProvider || DEFAULT_PROVIDER;
    const descriptor = factory.getProviderDescriptor(activeProvider);
    const storedProviderConfig = (stored.providers || {})[activeProvider] || {};

    const providerConfig = {};
    for (const field of descriptor.fields) {
      const raw = storedProviderConfig[field];
      providerConfig[field] = descriptor.secretFields.includes(field) ? clean(decryptSecret(raw)) : (raw ?? '');
    }

    return {
      isEnabled: Boolean(stored.isEnabled),
      activeProvider,
      providerConfig,
      lastTestStatus: storedProviderConfig.lastTestStatus || null,
      lastTestAt: storedProviderConfig.lastTestAt || null,
      lastTestError: storedProviderConfig.lastTestError || null
    };
  }

  async getPublicMetadata() {
    const config = await this.getRuntimeConfig();
    const descriptor = factory.getProviderDescriptor(config.activeProvider);
    const provider = factory.createProvider(config.activeProvider, config.providerConfig);

    const publicProviderConfig = {};
    for (const field of descriptor.fields) {
      if (descriptor.secretFields.includes(field)) publicProviderConfig[`${field}Configured`] = Boolean(config.providerConfig[field]);
      else publicProviderConfig[field] = config.providerConfig[field];
    }

    return {
      isEnabled: config.isEnabled,
      activeProvider: config.activeProvider,
      availableProviders: factory.listProviders(),
      capabilities: provider.capabilities,
      // Generic by design: whichever provider is active exposes its own
      // webhook endpoint the same way — a future provider without a
      // webhookSignature capability simply won't show one here.
      webhookUrl: provider.capabilities.webhookSignature ? `${publicBaseUrl()}${WEBHOOK_PATH}` : null,
      providerConfig: publicProviderConfig,
      lastTestStatus: config.lastTestStatus,
      lastTestAt: config.lastTestAt,
      lastTestError: config.lastTestError
    };
  }

  async save(payload = {}, userId = null) {
    const row = await this.row();
    const current = row.value || {};
    const activeProvider = payload.activeProvider !== undefined ? clean(payload.activeProvider) : (current.activeProvider || DEFAULT_PROVIDER);
    const descriptor = factory.getProviderDescriptor(activeProvider); // throws SMS_PROVIDER_UNKNOWN if invalid

    const currentProviders = current.providers || {};
    const currentProviderConfig = currentProviders[activeProvider] || {};
    const incomingProviderConfig = payload.providerConfig || {};

    const nextProviderConfig = { ...currentProviderConfig };
    const secretChanges = {};
    for (const field of descriptor.fields) {
      if (incomingProviderConfig[field] === undefined) continue;
      if (descriptor.secretFields.includes(field)) {
        // Blank input keeps the existing encrypted value untouched — never
        // overwrite a real secret with an empty string just because the
        // admin left the field blank on an unrelated save.
        const changed = Boolean(clean(incomingProviderConfig[field]));
        secretChanges[field] = changed;
        if (changed) nextProviderConfig[field] = encryptSecret(incomingProviderConfig[field]);
      } else {
        nextProviderConfig[field] = clean(incomingProviderConfig[field]);
      }
    }

    const enabledChanged = payload.isEnabled !== undefined && Boolean(payload.isEnabled) !== Boolean(current.isEnabled);
    const providerChanged = activeProvider !== (current.activeProvider || DEFAULT_PROVIDER);

    const next = {
      ...current,
      isEnabled: payload.isEnabled !== undefined ? Boolean(payload.isEnabled) : Boolean(current.isEnabled),
      activeProvider,
      providers: { ...currentProviders, [activeProvider]: nextProviderConfig }
    };

    await row.update({ value: next, updatedBy: userId || null });

    await auditService.record({
      userId,
      action: 'SMS_GATEWAY_SETTINGS_UPDATED',
      entityType: 'sms_gateway_settings',
      entityId: String(row.id),
      changes: { enabledChanged, providerChanged, activeProvider, secretChanges }
    });
    if (Object.values(secretChanges).some(Boolean)) {
      await auditService.record({
        userId,
        action: 'SMS_GATEWAY_KEY_REPLACED',
        entityType: 'sms_gateway_settings',
        entityId: String(row.id),
        changes: { activeProvider, secretChanges }
      });
    }

    return this.getPublicMetadata();
  }

  async _recordTestResult(activeProvider, status, error) {
    const row = await this.row();
    const current = row.value || {};
    const providers = current.providers || {};
    const providerConfig = providers[activeProvider] || {};
    await row.update({
      value: {
        ...current,
        providers: {
          ...providers,
          [activeProvider]: { ...providerConfig, lastTestStatus: status, lastTestAt: new Date().toISOString(), lastTestError: error }
        }
      }
    });
    return row;
  }

  async testConnection(userId = null) {
    const config = await this.getRuntimeConfig();
    const provider = factory.createProvider(config.activeProvider, config.providerConfig);
    if (!provider.isConfigured) throw notConfigured(config.activeProvider);

    try {
      const result = await provider.testConnection();
      const row = await this._recordTestResult(config.activeProvider, 'success', null);
      await auditService.record({ userId, action: 'SMS_GATEWAY_CONNECTION_TESTED', entityType: 'sms_gateway_settings', entityId: String(row.id), changes: { provider: config.activeProvider, status: 'success' } });
      return { status: 'success', provider: config.activeProvider, result };
    } catch (error) {
      const row = await this._recordTestResult(config.activeProvider, 'failed', error.message);
      await auditService.record({ userId, action: 'SMS_GATEWAY_CONNECTION_TESTED', entityType: 'sms_gateway_settings', entityId: String(row.id), changes: { provider: config.activeProvider, status: 'failed' } });
      throw error;
    }
  }

  async getMasks() {
    const config = await this.getRuntimeConfig();
    const provider = factory.createProvider(config.activeProvider, config.providerConfig);
    if (!provider.isConfigured) throw notConfigured(config.activeProvider);
    if (!provider.capabilities.masks) throw Object.assign(new Error(`The ${config.activeProvider} SMS provider does not support sender masks.`), { status: 409, code: 'SMS_PROVIDER_CAPABILITY_UNSUPPORTED', exposeMessage: true });
    return provider.getSenderMasks();
  }

  async getBalance() {
    const config = await this.getRuntimeConfig();
    const provider = factory.createProvider(config.activeProvider, config.providerConfig);
    if (!provider.isConfigured) throw notConfigured(config.activeProvider);
    if (!provider.capabilities.balance) throw Object.assign(new Error(`The ${config.activeProvider} SMS provider does not support a balance check.`), { status: 409, code: 'SMS_PROVIDER_CAPABILITY_UNSUPPORTED', exposeMessage: true });
    return provider.getBalance();
  }
}

module.exports = new SmsGatewaySettingsService();
