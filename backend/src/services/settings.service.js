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
  ['security', 'session', {
    enabled: process.env.SESSION_TIMEOUT_ENABLED === 'true',
    timeoutMinutes: Number(process.env.SESSION_TIMEOUT_MINUTES || 43200)
  }],
  ['notifications', 'assignments', {
    assignmentNotificationsEnabled: true
  }],
  ['class_reminders', 'automation', {
    class_reminder_auto_send_enabled: false,
    class_reminder_day_before_enabled: true,
    class_reminder_same_day_enabled: true,
    class_reminder_one_hour_enabled: true
  }],
  ['attendance_alerts', 'automation', {
    attendance_alert_auto_send_enabled: false,
    attendance_alert_absent_today_enabled: true,
    attendance_alert_consecutive_2_enabled: true,
    attendance_alert_consecutive_3_enabled: true,
    attendance_alert_below_75_enabled: true,
    attendance_alert_below_50_enabled: true,
    attendance_alert_send_to_student_enabled: true,
    attendance_alert_send_to_guardian_enabled: true
  }],
  ['birthday_wishes', 'automation', {
    birthday_auto_send_enabled: false,
    birthday_send_to_students_enabled: true,
    birthday_send_to_guardians_enabled: true
  }]
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
    if (namespace === 'attendance_alerts' && key === 'automation' && typeof value?.attendance_alert_auto_send_enabled === 'boolean') {
      const automationService = require('./automation.service');
      await automationService.ensureDefaults();
      const { Automation } = require('../models');
      const automation = await Automation.findOne({ where: { code: 'ATTENDANCE_ALERT' } });
      if (automation && automation.enabled !== value.attendance_alert_auto_send_enabled) {
        await automationService.toggleAutomation(automation.id, value.attendance_alert_auto_send_enabled);
      }
    }
    if (namespace === 'birthday_wishes' && key === 'automation' && typeof value?.birthday_auto_send_enabled === 'boolean') {
      const automationService = require('./automation.service');
      await automationService.ensureDefaults();
      const { Automation } = require('../models');
      const automation = await Automation.findOne({ where: { code: 'BIRTHDAY_WISH' } });
      if (automation && automation.enabled !== value.birthday_auto_send_enabled) {
        await automationService.toggleAutomation(automation.id, value.birthday_auto_send_enabled);
      }
    }
    return row;
  }
}

module.exports = new SettingsService();
