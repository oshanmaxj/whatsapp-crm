const { AppSetting } = require('../models');

const DEFAULTS = [
  ['company', 'profile', { name: 'WhatsApp CRM', phone: '', email: '', address: '' }],
  ['whatsapp', 'cloud_api', { phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '', verifyTokenConfigured: !!process.env.WHATSAPP_VERIFY_TOKEN, accessTokenConfigured: !!process.env.WHATSAPP_ACCESS_TOKEN }],
  ['smtp', 'settings', { host: '', port: 587, secure: false, username: '' }],
  ['branding', 'theme', { primaryColor: '#25d366', logoUrl: '' }],
  ['security', 'session', { timeoutMinutes: Number(process.env.SESSION_TIMEOUT_MINUTES || 120) }]
];

class SettingsService {
  async ensureDefaults() {
    for (const [namespace, key, value] of DEFAULTS) {
      await AppSetting.findOrCreate({ where: { namespace, key }, defaults: { value } });
    }
  }

  async list() {
    await this.ensureDefaults();
    return AppSetting.findAll({ order: [['namespace', 'ASC'], ['key', 'ASC']] });
  }

  async upsert(namespace, key, value, userId) {
    const [row] = await AppSetting.findOrCreate({ where: { namespace, key }, defaults: { value, updatedBy: userId || null } });
    await row.update({ value, updatedBy: userId || null });
    return row;
  }
}

module.exports = new SettingsService();
