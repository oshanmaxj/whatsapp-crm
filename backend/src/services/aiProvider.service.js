const axios = require('axios');
const models = require('../models');
const crypto = require('./secretCrypto.service');
const audit = require('./audit.service');
const allowedTypes = new Set(['openai', 'gemini', 'anthropic', 'openai_compatible']);
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
    if (!allowedTypes.has(payload.providerType)) throw Object.assign(new Error('Unsupported AI provider type.'), { status: 400 });
    const values = { ...payload, updatedBy: user.id }; delete values.apiKey; delete values.encryptedApiKey; delete values.keyIv; delete values.keyTag; delete values.keyConfigured;
    let row;
    if (id) { row = await this.get(id, true); await row.update(values); }
    else row = await models.AiProvider.create({ ...values, createdBy: user.id });
    if (payload.apiKey) { await row.update(crypto.encrypt(payload.apiKey)); await this.record(user, id ? 'AI_PROVIDER_KEY_REPLACED' : 'AI_PROVIDER_KEY_CREATED', row.id); }
    if (row.isDefault) await models.AiProvider.update({ isDefault: false }, { where: { id: { [require('sequelize').Op.ne]: row.id } } });
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
      throw Object.assign(new Error('Provider connection test failed. Verify the provider settings and key.'), { status: 422, code: 'AI_PROVIDER_TEST_FAILED' });
    }
  }
  record(user, action, id, changes = {}) { return audit.record({ userId: user.id, action, entityType: 'ai_provider', entityId: id, method: 'POST', path: '/api/ai-providers', changes }); }
}
module.exports = new AiProviderService();
