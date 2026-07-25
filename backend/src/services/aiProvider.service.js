const axios = require('axios');
const models = require('../models');
const crypto = require('./secretCrypto.service');
const audit = require('./audit.service');
const allowedTypes = new Set(['openai', 'gemini', 'anthropic', 'openai_compatible']);
const optional = value => value === undefined || value === null || String(value).trim() === '' ? null : String(value).trim();
const validation = errors => Object.assign(new Error('Validation failed'), { status: 422, code: 'VALIDATION_FAILED', errors });
const normalize = payload => ({
  ...payload,
  name: String(payload.name || '').trim(),
  providerType: String(payload.providerType || '').trim().toLowerCase(),
  apiBaseUrl: optional(payload.apiBaseUrl ?? payload.baseUrl)?.replace(/\/+$/, '') || null,
  model: String(payload.model ?? payload.defaultModel ?? '').trim(),
  apiKey: optional(payload.apiKey),
  organizationId: optional(payload.organizationId),
  projectId: optional(payload.projectId),
  dailyBudget: optional(payload.dailyBudget)
});
const publicRow = row => {
  const value = row.toJSON ? row.toJSON() : { ...row };
  delete value.encryptedApiKey; delete value.keyIv; delete value.keyTag;
  value.keyConfigured = Boolean(row.encryptedApiKey); return value;
};
class AiProviderService {
  async list() { return (await models.AiProvider.unscoped().findAll({ order: [['is_default', 'DESC'], ['name', 'ASC']] })).map(publicRow); }
  async get(id, secret = false) {
    const row = await models.AiProvider.unscoped().findByPk(id);
    if (!row) throw Object.assign(new Error('AI provider not found.'), { status: 404 });
    return secret ? row : publicRow(row);
  }
  async save(id, payload, user) {
    const input = normalize(payload);
    const errors = {};
    if (!input.name) errors.name = 'Provider name is required.';
    if (!allowedTypes.has(input.providerType)) errors.providerType = 'Choose a supported provider type.';
    if (!input.model) errors.model = 'Model is required.';
    if (input.apiBaseUrl) {
      try { const url = new URL(input.apiBaseUrl); if (url.protocol !== 'https:') errors.apiBaseUrl = 'API Base URL must use HTTPS.'; }
      catch { errors.apiBaseUrl = 'Enter a valid API Base URL.'; }
    }
    if (!id && !input.apiKey) errors.apiKey = 'API key is required.';
    if (Object.keys(errors).length) throw validation(errors);
    const encrypted = input.apiKey ? crypto.encrypt(input.apiKey) : null;
    const values = { ...input, updatedBy: user.id };
    delete values.apiKey; delete values.baseUrl; delete values.defaultModel; delete values.encryptedApiKey; delete values.keyIv; delete values.keyTag; delete values.keyConfigured;
    let row;
    await models.sequelize.transaction(async transaction => {
      if (id) {
        row = await models.AiProvider.unscoped().findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!row) throw Object.assign(new Error('AI provider not found.'), { status: 404 });
        await row.update({ ...values, ...(encrypted || {}) }, { transaction });
      } else {
        row = await models.AiProvider.create({ ...values, ...encrypted, createdBy: user.id }, { transaction });
      }
      if (row.isDefault) await models.AiProvider.update({ isDefault: false }, { where: { id: { [require('sequelize').Op.ne]: row.id } }, transaction });
    });
    if (encrypted) await this.record(user, id ? 'AI_PROVIDER_KEY_REPLACED' : 'AI_PROVIDER_KEY_CREATED', row.id);
    return publicRow(row);
  }
  async remove(id, user) { const row = await this.get(id, true); await row.destroy(); await this.record(user, 'AI_PROVIDER_DELETED', id); return { id }; }
  async removeKey(id, user) { const row = await this.get(id, true); await row.update({ encryptedApiKey: null, keyIv: null, keyTag: null }); await this.record(user, 'AI_PROVIDER_KEY_REMOVED', id); return publicRow(row); }
  async setDefault(id, user) { const row = await this.get(id, true); await models.sequelize.transaction(async t => { await models.AiProvider.update({ isDefault: false }, { where: {}, transaction: t }); await row.update({ isDefault: true, updatedBy: user.id }, { transaction: t }); }); return publicRow(row); }
  async test(id, user) {
    const row = await this.get(id, true);
    if (!row.encryptedApiKey) throw Object.assign(new Error('No API key is configured.'), { status: 409 });
    const key = crypto.decrypt(row), timeout = Math.min(row.requestTimeout || 30000, 60000);
    try {
      if (row.providerType === 'gemini') await axios.get(`${row.apiBaseUrl || 'https://generativelanguage.googleapis.com/v1beta'}/models`, { params: { key }, timeout });
      else if (row.providerType === 'anthropic') await axios.post(`${row.apiBaseUrl || 'https://api.anthropic.com/v1'}/messages`, { model: row.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, timeout });
      else await axios.get(`${row.apiBaseUrl || 'https://api.openai.com/v1'}/models`, { headers: { Authorization: `Bearer ${key}`, ...(row.organizationId ? { 'OpenAI-Organization': row.organizationId } : {}) }, timeout });
      await row.update({ lastTestStatus: 'success', lastTestAt: new Date() }); await this.record(user, 'AI_PROVIDER_CONNECTION_TESTED', id, { status: 'success' }); return { status: 'success', testedAt: row.lastTestAt };
    } catch (error) {
      await row.update({ lastTestStatus: 'failed', lastTestAt: new Date() }); await this.record(user, 'AI_PROVIDER_CONNECTION_TESTED', id, { status: 'failed' });
      const providerStatus = error.response?.status;
      const providerCode = error.response?.data?.error?.code;
      let message = 'Provider connection test failed. Verify the provider settings.';
      if (providerStatus === 401 || providerCode === 'invalid_api_key') message = 'OpenAI rejected the API key.';
      else if (providerStatus === 429) message = 'OpenAI rate limit or billing quota prevented the connection test.';
      else if (providerStatus === 404 || providerCode === 'model_not_found') message = 'The configured OpenAI model is unavailable to this account.';
      throw Object.assign(new Error(message), { status: 422, code: 'AI_PROVIDER_TEST_FAILED' });
    }
  }
  record(user, action, id, changes = {}) { return audit.record({ userId: user.id, action, entityType: 'ai_provider', entityId: id, method: 'POST', path: '/api/ai-providers', changes }); }
}
module.exports = new AiProviderService();
