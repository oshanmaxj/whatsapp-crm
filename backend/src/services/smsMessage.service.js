const { SmsMessage } = require('../models');
const smsService = require('./sms/sms.service');
const { normalizeSriLankanPhone } = require('../utils/phone');
const auditService = require('./audit.service');

class SmsMessageService {
  // Ad-hoc / test single send: validates and normalizes the recipient,
  // writes an sms_messages row up front (so a send that throws after being
  // accepted by the provider is still recorded), then updates it with the
  // outcome. This is business logic, so it calls the generic sms.service.js
  // facade only — it never knows or cares which provider is active. Later
  // phases (MessageQueue 'sms' channel, campaigns, reminders) follow the
  // same rule.
  async sendSingle({ to, message, mask, campaignName, source = 'manual', contactId, leadId, studentId }, user) {
    const toNumber = normalizeSriLankanPhone(to);
    if (!toNumber) throw Object.assign(new Error('A valid Sri Lankan phone number is required.'), { status: 400, code: 'INVALID_PHONE_NUMBER' });
    if (!String(message || '').trim()) throw Object.assign(new Error('Message text is required.'), { status: 422, code: 'VALIDATION_FAILED', errors: { message: 'Message text is required.' } });

    const record = await SmsMessage.create({
      toNumber,
      message,
      mask: mask || null,
      provider: null,
      status: 'queued',
      campaignName: campaignName || null,
      source,
      contactId: contactId || null,
      leadId: leadId || null,
      studentId: studentId || null,
      createdBy: user?.id || null
    });

    try {
      const result = await smsService.sendSms({ to: toNumber, message, mask, campaignName });
      await record.update({
        status: 'sent',
        provider: result.provider,
        providerMessageId: result.providerMessageId || null,
        providerStatus: result.providerStatus || null,
        providerMetadata: result.raw || null,
        mask: result.mask || mask || null,
        segments: result.segments ?? null,
        cost: result.cost ?? null,
        sentAt: new Date()
      });
      await auditService.record({ userId: user?.id, action: 'SMS_SENT', entityType: 'sms_message', entityId: String(record.id), changes: { to: toNumber, provider: result.provider, source } });
      return record;
    } catch (error) {
      await record.update({ status: 'failed', provider: error.provider || null, errorMessage: error.message, failedAt: new Date() });
      await auditService.record({ userId: user?.id, action: 'SMS_SEND_FAILED', entityType: 'sms_message', entityId: String(record.id), changes: { to: toNumber, provider: error.provider || null, source, error: error.message } });
      throw error;
    }
  }
}

module.exports = new SmsMessageService();
