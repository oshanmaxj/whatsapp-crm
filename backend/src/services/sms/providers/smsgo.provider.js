const axios = require('axios');
const crypto = require('crypto');
const logger = require('../../../config/logger');
const { normalizeSriLankanPhone } = require('../../../utils/phone');
const { BaseSmsProvider } = require('./baseProvider');

const DEFAULT_BASE_URL = 'https://api.smsgo.lk/api/v1';
const MAX_BULK_BATCH = 1000;
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

// Maps SMSGo's own (undocumented, best-effort) status vocabulary to the
// CRM's canonical set. Only this file needs updating if SMSGo's real values
// turn out different once live delivery reports are observed.
const SMSGO_STATUS_MAP = {
  queued: 'queued', pending: 'queued', accepted: 'queued', submitted: 'queued',
  sent: 'sent',
  delivered: 'delivered', delivrd: 'delivered',
  failed: 'failed', undelivered: 'failed', undeliverable: 'failed', error: 'failed', expired: 'failed',
  rejected: 'rejected', invalid: 'rejected', blocked: 'rejected'
};

// SMSGo's own wording for an unapproved sender mask (observed live:
// `Mask "First Of Ed" not approved. Available masks: `). Detected here, not
// in generic business logic or the frontend, so the rest of the CRM only
// ever sees a provider-neutral SENDER_MASK_NOT_APPROVED code — a future
// provider that rejects unapproved masks differently just needs its own
// adapter to map its own wording to the same code.
const MASK_NOT_APPROVED_PATTERN = /mask.*not approved/i;
const MASK_NOT_APPROVED_MESSAGE = 'SMS could not be sent because the selected sender mask is not approved by the SMS provider.';

function invalidPhone(value) {
  return Object.assign(new Error(`Invalid Sri Lankan phone number: ${value}`), { status: 400, code: 'INVALID_PHONE_NUMBER' });
}

// `technicalMessage` preserves the exact provider wording for logging/SMS
// History diagnostics even when `message` (what reaches the API response
// and the UI) has been swapped for a clean, generic explanation.
function gatewayError(message, { status = 502, code = 'SMSGO_REQUEST_FAILED', cause, technicalMessage } = {}) {
  return Object.assign(new Error(message), { status, code, exposeMessage: true, cause, technicalMessage: technicalMessage || message });
}

function unwrapError(error, fallbackMessage) {
  if (error.response) {
    const providerMessage = error.response.data?.message || error.response.data?.error || fallbackMessage;
    const status = error.response.status >= 400 && error.response.status < 500 ? 422 : 502;
    if (MASK_NOT_APPROVED_PATTERN.test(providerMessage)) {
      return gatewayError(MASK_NOT_APPROVED_MESSAGE, { status: 422, code: 'SENDER_MASK_NOT_APPROVED', cause: error, technicalMessage: providerMessage });
    }
    return gatewayError(providerMessage, { status, code: 'SMSGO_REQUEST_FAILED', cause: error, technicalMessage: providerMessage });
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
    this.webhookSecret = config.webhookSecret || null;
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

  // Normalizes SMSGo's `{success, data: {balance, currency}}` envelope into
  // the provider-neutral `{balance, currency}` shape — this is the only
  // place that shape is ever parsed. Nothing above this adapter (settings
  // service, controller, frontend) ever sees the raw response.
  async getBalance() {
    try {
      const response = await withRetry(() => this.client().get('/account/balance'));
      const data = response.data?.data || response.data || {};
      const balance = Number(data.balance);
      return {
        balance: Number.isFinite(balance) ? balance : null,
        currency: data.currency || null
      };
    } catch (error) {
      throw unwrapError(error, 'Unable to fetch the SMSGo account balance.');
    }
  }

  // Normalizes whatever shape SMSGo's masks endpoint returns (a bare array,
  // `{data: [...]}}`, `{masks: [...]}}`, entries as plain strings or as
  // objects) into a flat array of mask id strings — the only shape the
  // generic layer and frontend ever need to render a picker.
  async getSenderMasks() {
    try {
      const response = await withRetry(() => this.client().get('/account/masks'));
      const data = response.data;
      const list = Array.isArray(data) ? data : (data?.data || data?.masks || []);
      return list
        .map((entry) => (typeof entry === 'string' ? entry : (entry?.mask || entry?.name || entry?.id || null)))
        .filter((mask) => Boolean(mask));
    } catch (error) {
      throw unwrapError(error, 'Unable to fetch approved SMSGo sender masks.');
    }
  }

  async testConnection() {
    const balance = await this.getBalance();
    return { mode: this.mode, balance };
  }

  // CONFIRMED (2026-09-23) against SMSGo's own published Go SDK
  // documentation (pkg.go.dev/github.com/sms-go/smsgo-sdk-go —
  // VerifyWebhookSignature godoc): "Each request carries
  // `X-SMSGo-Signature: sha256=<hmac>` — the HMAC-SHA256 of the raw body
  // with your `secret`", where that secret is a DEDICATED webhook secret
  // (format `whsec_...`, obtained via the SDK's Client.SetWebhook() when
  // registering the callback URL with SMSGo) — NOT the send API key. The
  // previous version of this method got both of these wrong: it keyed the
  // HMAC with `this.apiKey` (the send credential) instead of a webhook
  // secret, and compared against the header's raw value instead of
  // stripping the documented `sha256=` prefix — so even a correct secret
  // could never have matched, and every real webhook was rejected with 401
  // regardless of payload validity. Express lower-cases incoming header
  // names, hence `x-smsgo-signature` here.
  verifyWebhookSignature({ headers, rawBody }) {
    if (!this.webhookSecret) return false;
    const signatureHeader = headers?.['x-smsgo-signature'];
    if (!signatureHeader || !rawBody) return false;
    const match = /^sha256=([0-9a-f]+)$/i.exec(String(signatureHeader).trim());
    if (!match) return false;
    const expected = crypto.createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(match[1].toLowerCase(), 'utf8');
    if (expectedBuffer.length !== providedBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
  }

  // SMSGo's own status vocabulary isn't documented beyond the `sms.status_update`
  // event name, so this maps the plausible raw values defensively into the
  // CRM's canonical set (queued/sent/delivered/failed/rejected/unknown) —
  // this mapping table is exactly the "provider status mapping" that must
  // stay inside the adapter. Anything unrecognized becomes 'unknown' rather
  // than guessed at, so it fails safe instead of silently misclassifying a
  // delivery outcome.
  normalizeWebhookEvent(payload) {
    const data = payload?.data || payload || {};
    const rawStatus = String(data.status || payload?.status || '').trim();
    const status = SMSGO_STATUS_MAP[rawStatus.toLowerCase()] || 'unknown';
    return {
      provider: this.name,
      providerMessageId: data.messageId || data.id || null,
      recipient: data.to || data.recipient || null,
      status,
      error: data.error || data.reason || null,
      timestamp: data.timestamp || payload?.timestamp || new Date().toISOString(),
      metadata: { rawStatus: rawStatus || null, raw: payload }
    };
  }
}

module.exports = SmsGoProvider;
