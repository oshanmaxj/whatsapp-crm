const { Op } = require('sequelize');
const { SmsMessage, Contact, Lead, Student, User } = require('../models');
const smsService = require('./sms/sms.service');
const { normalizeSriLankanPhone } = require('../utils/phone');
const auditService = require('./audit.service');
const logger = require('../config/logger');

const RELATED_INCLUDES = [
  { model: Contact, as: 'contact', attributes: ['id', 'firstName', 'lastName', 'phone'] },
  { model: Lead, as: 'lead', attributes: ['id', 'contactId'], include: [{ model: Contact, as: 'contact', attributes: ['id', 'firstName', 'lastName', 'phone'] }] },
  { model: Student, as: 'student', attributes: ['id', 'name', 'phone'] },
  { model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'] }
];

// logger.redact() (config/logger.js) is tuned for our own outbound request
// logs (authorization/bearer/app secret/client secret) and doesn't cover
// "apiKey"/"api_key"/"x-api-key"/"signature" — precisely the shapes a raw
// SMS provider webhook/response payload could plausibly echo back under.
// providerMetadata is exactly that raw payload, so it gets this stricter,
// key-name-based pass on top, recursively, before ever leaving the server.
const CREDENTIAL_KEY_PATTERN = /api[_-]?key|apikey|signature|secret|authorization|access[_-]?token|bearer/i;
function redactCredentialLikeKeys(value) {
  if (Array.isArray(value)) return value.map(redactCredentialLikeKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
      key,
      CREDENTIAL_KEY_PATTERN.test(key) ? '[REDACTED]' : redactCredentialLikeKeys(child)
    ]));
  }
  return value;
}

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
      // SMS History (an admin diagnostics view) gets the full technical/
      // provider-specific error text when the adapter preserved one (e.g. a
      // clean-for-users message like the sender-mask-not-approved case
      // still keeps its raw provider wording here); the error re-thrown
      // below — and therefore the immediate API response / UI alert — keeps
      // whatever clean `message` the adapter chose to surface instead.
      await record.update({ status: 'failed', provider: error.provider || null, errorMessage: error.technicalMessage || error.message, failedAt: new Date() });
      await auditService.record({ userId: user?.id, action: 'SMS_SEND_FAILED', entityType: 'sms_message', entityId: String(record.id), changes: { to: toNumber, provider: error.provider || null, source, error: error.message } });
      throw error;
    }
  }

  // Automatic student-notification sends (welcome/class reminder/birthday/
  // payment reminder) go through this instead of sendSingle(): the caller
  // supplies a durable `dedupeKey` (unique per occurrence — e.g. per
  // student+year for a birthday wish) which is claimed via the sms_messages
  // unique index BEFORE the provider is called, so a duplicate automatic
  // dispatch (worker restart, re-run) can never double-send — it just finds
  // the row it already claimed and returns it. Never throws: automatic sends
  // must never break the caller (registration, class reminder generation,
  // etc.), so every outcome — invalid phone, duplicate, provider failure —
  // comes back as a status on the returned object instead.
  async sendAutomated({ dedupeKey, to, message, source, studentId, contactId, leadId, createdBy }) {
    if (!dedupeKey) throw Object.assign(new Error('dedupeKey is required for automated SMS sends.'), { status: 500 });

    let toNumber;
    try {
      toNumber = normalizeSriLankanPhone(to);
      if (!toNumber) throw new Error('invalid');
    } catch {
      return { status: 'skipped', reason: 'invalid_phone' };
    }
    if (!String(message || '').trim()) return { status: 'skipped', reason: 'empty_message' };

    let record;
    try {
      record = await SmsMessage.create({
        toNumber, message, provider: null, status: 'queued', source: source || 'automatic',
        dedupeKey, contactId: contactId || null, leadId: leadId || null, studentId: studentId || null,
        createdBy: createdBy || null
      });
    } catch (error) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        const existing = await SmsMessage.findOne({ where: { dedupeKey } });
        return { status: 'duplicate', record: existing };
      }
      logger.warn('sms_automated_claim_failed', { source, studentId, error: error.message });
      return { status: 'failed', reason: 'claim_failed' };
    }

    try {
      const result = await smsService.sendSms({ to: toNumber, message });
      await record.update({
        status: 'sent',
        provider: result.provider,
        providerMessageId: result.providerMessageId || null,
        providerStatus: result.providerStatus || null,
        providerMetadata: result.raw || null,
        mask: result.mask || null,
        segments: result.segments ?? null,
        cost: result.cost ?? null,
        sentAt: new Date()
      });
      return { status: 'sent', record };
    } catch (error) {
      await record.update({ status: 'failed', provider: error.provider || null, errorMessage: error.technicalMessage || error.message, failedAt: new Date() });
      logger.warn('sms_automated_send_failed', { source, studentId, provider: error.provider || null, error: error.message });
      return { status: 'failed', reason: 'send_failed', record };
    }
  }

  // Server-side paginated/filterable list for the SMS History page. Never
  // loads the full table — always bounded by limit/offset.
  async list({ status, provider, phone, dateFrom, dateTo, page = 1, pageSize = 25 } = {}) {
    const where = {};
    if (status) where.status = status;
    if (provider) where.provider = provider;
    if (phone) where.toNumber = { [Op.iLike]: `%${String(phone).replace(/\D/g, '')}%` };
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt[Op.gte] = new Date(dateFrom);
      if (dateTo) where.createdAt[Op.lte] = new Date(dateTo);
    }

    const limit = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
    const currentPage = Math.max(Number(page) || 1, 1);
    const offset = (currentPage - 1) * limit;

    const { rows, count } = await SmsMessage.findAndCountAll({
      where, limit, offset, order: [['createdAt', 'DESC']], include: RELATED_INCLUDES, distinct: true
    });

    return { rows, total: count, page: currentPage, pageSize: limit, totalPages: Math.max(Math.ceil(count / limit), 1) };
  }

  async getById(id) {
    const record = await SmsMessage.findByPk(id, { include: RELATED_INCLUDES });
    if (!record) throw Object.assign(new Error('SMS message not found.'), { status: 404, code: 'SMS_MESSAGE_NOT_FOUND' });
    // Defense-in-depth: providerMetadata is whatever raw payload the
    // provider sent us, so it's redacted through the same generic
    // secret-key/value scrubber the request logger uses before ever
    // leaving the server, even though a provider has no legitimate reason
    // to echo our own API key back to us.
    const json = record.toJSON();
    json.providerMetadata = redactCredentialLikeKeys(logger.redact(json.providerMetadata));
    return json;
  }
}

module.exports = new SmsMessageService();
