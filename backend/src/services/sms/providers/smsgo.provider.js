const axios = require('axios');
const crypto = require('crypto');
const logger = require('../../../config/logger');
const { normalizeSriLankanPhone } = require('../../../utils/phone');
const { BaseSmsProvider } = require('./baseProvider');

const DEFAULT_BASE_URL = 'https://api.smsgo.lk/api/v1';
const MAX_BULK_BATCH = 1000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function invalidPhone(value) {
  return Object.assign(new Error(`Invalid Sri Lankan phone number: ${value}`), { status: 400, code: 'INVALID_PHONE_NUMBER' });
}

function gatewayError(message, { status = 502, code = 'SMSGO_REQUEST_FAILED', cause } = {}) {
  return Object.assign(new Error(message), { status, code, exposeMessage: true, cause });
}

function unwrapError(error, fallbackMessage) {
  if (error.response) {
    const message = error.response.data?.message || error.response.data?.error || fallbackMessage;
    const status = error.response.status >= 400 && error.response.status < 500 ? 422 : 502;
    return gatewayError(message, { status, code: 'SMSGO_REQUEST_FAILED', cause: error });
  }
  return gatewayError(fallbackMessage, { status: 502, code: 'SMSGO_UNREACHABLE', cause: error });
}

async function withRetry(fn, { attempts = 2 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      const retryable = !status || RETRYABLE_STATUS.has(status);
      if (!retryable || attempt === attempts) break;
      logger.warn('smsgo_request_retrying', { attempt, status, message: error.message });
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }
  }
  throw lastError;
}

// This is the only file in the codebase that should know SMSGo's base URL,
// auth header, payload shapes, and webhook signature scheme. Everything
// above this adapter (sms.service.js and all business logic) talks in
// provider-neutral terms only.
class SmsGoProvider extends BaseSmsProvider {
  constructor(config = {}) {
    super(config);
    this.mode = config.mode === 'live' ? 'live' : 'sandbox';
    this.apiKey = this.mode === 'live' ? config.liveApiKey : config.sandboxApiKey;
    this.defaultMask = config.defaultMask || null;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  }

  get name() { return 'smsgo'; }

  get isConfigured() { return Boolean(this.apiKey); }

  get capabilities() { return { bulk: true, balance: true, masks: true, sandbox: true, webhookSignature: true }; }

  client(timeout = 15000) {
    return axios.create({ baseURL: this.baseUrl, timeout, headers: { 'X-API-Key': this.apiKey } });
  }

  async sendSms({ to, message, mask, campaignName }) {
    const toNumber = normalizeSriLankanPhone(to);
    if (!toNumber) throw invalidPhone(to);
    if (!String(message || '').trim()) throw Object.assign(new Error('Message text is required.'), { status: 422, code: 'VALIDATION_FAILED' });

    try {
      const response = await withRetry(() => this.client().post('/sms/send', {
        to: toNumber,
        message,
        ...(mask ? { mask } : {}),
        ...(campaignName ? { campaignName } : {})
      }));
      logger.info('smsgo_send_succeeded', { to: toNumber, mask: mask || null });
      const data = response.data || {};
      return {
        providerMessageId: data.messageId || data.id || data.data?.messageId || null,
        providerStatus: data.status || data.data?.status || null,
        segments: data.segments ?? data.data?.segments ?? null,
        cost: data.cost ?? data.data?.cost ?? null,
        raw: { mode: this.mode, response: data }
      };
    } catch (error) {
      logger.error('smsgo_send_failed', { to: toNumber, message: error.message });
      throw unwrapError(error, 'SMSGo rejected the send request.');
    }
  }

  async sendBulkSms({ messages }) {
    if (!Array.isArray(messages) || !messages.length) throw Object.assign(new Error('At least one message is required.'), { status: 422, code: 'VALIDATION_FAILED' });

    const normalized = messages.map((entry) => {
      const toNumber = normalizeSriLankanPhone(entry.to);
      if (!toNumber) throw invalidPhone(entry.to);
      if (!String(entry.message || '').trim()) throw Object.assign(new Error('Message text is required for every recipient.'), { status: 422, code: 'VALIDATION_FAILED' });
      return { to: toNumber, message: entry.message };
    });

    const results = [];
    for (let offset = 0; offset < normalized.length; offset += MAX_BULK_BATCH) {
      const batch = normalized.slice(offset, offset + MAX_BULK_BATCH);
      try {
        const response = await withRetry(() => this.client(30000).post('/sms/bulk', { messages: batch }));
        logger.info('smsgo_bulk_batch_succeeded', { batchSize: batch.length, offset });
        results.push({ raw: { mode: this.mode, response: response.data }, batchSize: batch.length });
      } catch (error) {
        logger.error('smsgo_bulk_batch_failed', { batchSize: batch.length, offset, message: error.message });
        throw unwrapError(error, 'SMSGo rejected the bulk send request.');
      }
    }
    return results;
  }

  async getBalance() {
    try {
      const response = await withRetry(() => this.client().get('/account/balance'));
      return response.data;
    } catch (error) {
      throw unwrapError(error, 'Unable to fetch the SMSGo account balance.');
    }
  }

  async getSenderMasks() {
    try {
      const response = await withRetry(() => this.client().get('/account/masks'));
      const data = response.data;
      return Array.isArray(data) ? data : (data?.masks || data?.data || []);
    } catch (error) {
      throw unwrapError(error, 'Unable to fetch approved SMSGo sender masks.');
    }
  }

  async testConnection() {
    const balance = await this.getBalance();
    return { mode: this.mode, balance };
  }

  // req: { rawBody: Buffer|string, signatureHeader: string }. SMSGo signs
  // with HMAC-SHA256 keyed by the active API key.
  verifyWebhookSignature({ rawBody, signatureHeader }) {
    if (!this.apiKey || !signatureHeader) return false;
    const expected = crypto.createHmac('sha256', this.apiKey).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(String(signatureHeader), 'utf8');
    if (expectedBuffer.length !== providedBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  }

  // SMSGo's `sms.status_update` payload shape isn't documented beyond the
  // event name, so this maps the plausible fields defensively rather than
  // assuming an exact structure.
  normalizeWebhookEvent(payload) {
    const data = payload?.data || payload || {};
    return {
      provider: this.name,
      providerMessageId: data.messageId || data.id || null,
      status: String(data.status || payload?.status || '').toLowerCase() || 'unknown',
      recipient: data.to || data.recipient || null,
      error: data.error || data.reason || null,
      timestamp: data.timestamp || payload?.timestamp || new Date().toISOString(),
      rawMetadata: payload
    };
  }
}

module.exports = SmsGoProvider;
