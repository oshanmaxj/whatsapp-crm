const { AppSetting } = require('../models');

const defaults = () => ({
  prefix: process.env.RECEIPT_PREFIX || 'RCPT',
  companyName: process.env.RECEIPT_COMPANY_NAME || 'First Of Education International (PVT) Ltd',
  registrationNumber: process.env.RECEIPT_COMPANY_REGISTRATION_NUMBER || 'PV 00267065',
  currency: process.env.RECEIPT_CURRENCY || 'LKR',
  autoGenerate: process.env.RECEIPT_AUTO_GENERATE !== 'false',
  autoSendWhatsapp: process.env.RECEIPT_AUTO_SEND_WHATSAPP !== 'false',
  address: process.env.COMPANY_ADDRESS || '',
  phone: process.env.COMPANY_PHONE || '',
  email: process.env.COMPANY_EMAIL || '',
  logoUrl: '',
  signatureUrl: '',
  footerText: 'This is a computer-generated receipt and does not require a physical signature.',
  verificationBaseUrl: process.env.RECEIPT_VERIFICATION_BASE_URL || 'https://crm.firstofsolutions.com/receipt/verify'
});

class PaymentReceiptSettingsService {
  async get() {
    const [receipt, company, branding] = await Promise.all([
      AppSetting.findOne({ where: { namespace: 'receipts', key: 'settings' } }),
      AppSetting.findOne({ where: { namespace: 'company', key: 'profile' } }),
      AppSetting.findOne({ where: { namespace: 'branding', key: 'theme' } })
    ]);
    const resolved = {
      ...defaults(),
      ...(company?.value || {}),
      ...(branding?.value || {}),
      ...(receipt?.value || {})
    };
    resolved.companyName = receipt?.value?.companyName || company?.value?.name || resolved.companyName;
    resolved.logoUrl = receipt?.value?.logoUrl || branding?.value?.logoUrl || resolved.logoUrl;
    return resolved;
  }

  async update(value, actorUserId) {
    const current = await this.get();
    const allowed = [
      'prefix', 'companyName', 'registrationNumber', 'currency', 'autoGenerate', 'autoSendWhatsapp',
      'address', 'phone', 'email', 'logoUrl', 'signatureUrl', 'footerText', 'verificationBaseUrl',
      'outsideWindowTemplateName'
    ];
    const next = { ...current };
    for (const field of allowed) if (Object.prototype.hasOwnProperty.call(value || {}, field)) next[field] = value[field];
    const [row] = await AppSetting.findOrCreate({
      where: { namespace: 'receipts', key: 'settings' },
      defaults: { value: next, updatedBy: actorUserId || null }
    });
    await row.update({ value: next, updatedBy: actorUserId || null });
    return next;
  }
}

module.exports = new PaymentReceiptSettingsService();
module.exports.defaults = defaults;
