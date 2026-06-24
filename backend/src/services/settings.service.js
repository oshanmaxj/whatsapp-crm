const { AppSetting } = require('../models');
const companyName = process.env.COMPANY_NAME || 'First Of Education International';

const DEFAULTS = [
  ['company', 'profile', {
    name: companyName,
    phone: process.env.COMPANY_PHONE || '',
    email: process.env.COMPANY_EMAIL || '',
    address: process.env.COMPANY_ADDRESS || ''
  }],
  ['whatsapp', 'cloud_api', {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyTokenConfigured: !!process.env.WHATSAPP_VERIFY_TOKEN,
    accessTokenConfigured: !!process.env.WHATSAPP_ACCESS_TOKEN,
    sendEnabled: process.env.WHATSAPP_SEND_ENABLED === 'true'
  }],
  ['smtp', 'settings', { host: '', port: 587, secure: false, username: '' }],
  ['branding', 'theme', { primaryColor: '#25d366', logoUrl: '' }],
  ['security', 'session', { timeoutMinutes: Number(process.env.SESSION_TIMEOUT_MINUTES || 120) }]
];

class SettingsService {
  async ensureDefaults() {
    for (const [namespace, key, value] of DEFAULTS) {
      const [row, created] = await AppSetting.findOrCreate({ where: { namespace, key }, defaults: { value } });

      if (!created && namespace === 'company' && key === 'profile') {
        const current = row.value || {};
        if (!current.name || current.name === 'WhatsApp CRM') {
          await row.update({
            value: {
              ...value,
              ...current,
              name: companyName
            }
          });
        }
      }

      if (!created && namespace === 'whatsapp' && key === 'cloud_api') {
        const current = row.value || {};
        await row.update({
          value: {
            ...current,
            phoneNumberId: current.phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '',
            verifyTokenConfigured: !!(current.verifyToken || process.env.WHATSAPP_VERIFY_TOKEN),
            accessTokenConfigured: !!(current.accessToken || process.env.WHATSAPP_ACCESS_TOKEN),
            sendEnabled: process.env.WHATSAPP_SEND_ENABLED === 'true'
          }
        });
      }
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
