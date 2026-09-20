// Contract every SMS provider adapter implements. `sendSms()` and
// `testConnection()` are mandatory; everything else is an optional
// capability that defaults to "not supported" here so a provider only has
// to override what it actually offers. Callers (sms.service.js,
// smsGatewaySettings.service.js) check `capabilities`/`isConfigured` before
// calling an optional method, and fall back where a sane fallback exists
// (e.g. looping sendSms() when sendBulkSms() isn't implemented).
class BaseSmsProvider {
  constructor(config = {}) {
    this.config = config;
  }

  get name() { throw notImplemented('name'); }

  // Whether this adapter has enough configuration (credentials) to attempt
  // a send right now. Provider-specific — e.g. SMSGo looks at whichever of
  // its sandbox/live keys matches its configured mode.
  get isConfigured() { return false; }

  get capabilities() {
    return { bulk: false, balance: false, masks: false, sandbox: false, webhookSignature: false };
  }

  async sendSms(/* { to, message, mask, campaignName } */) { throw notImplemented('sendSms'); }
  async sendBulkSms(/* { messages } */) { throw notSupported(this.name, 'sendBulkSms'); }
  async getBalance() { throw notSupported(this.name, 'getBalance'); }
  async getSenderMasks() { throw notSupported(this.name, 'getSenderMasks'); }
  async testConnection() { throw notImplemented('testConnection'); }
  // Takes the raw request's headers + raw body verbatim — which header(s)
  // carry the signature, and how it's computed, is entirely up to the
  // adapter. The generic webhook controller never inspects a signature
  // header itself. Shape: { headers: object, rawBody: Buffer }
  verifyWebhookSignature(/* { headers, rawBody } */) { throw notSupported(this.name, 'verifyWebhookSignature'); }
  // Must map the provider's own payload AND its own status vocabulary into
  // the CRM's canonical shape/status set — that mapping is provider-specific
  // and belongs here, not in generic business logic. `status` must already
  // be one of: queued, sent, delivered, failed, rejected, unknown.
  // Returns: { provider, providerMessageId, recipient, status, error, timestamp, metadata }
  normalizeWebhookEvent(/* payload */) { throw notSupported(this.name, 'normalizeWebhookEvent'); }
}

function notImplemented(method) {
  return Object.assign(new Error(`${method}() must be implemented by the provider adapter.`), { code: 'SMS_PROVIDER_METHOD_MISSING' });
}

function notSupported(provider, method) {
  return Object.assign(new Error(`The "${provider}" SMS provider does not support ${method}().`), {
    status: 409, code: 'SMS_PROVIDER_CAPABILITY_UNSUPPORTED', exposeMessage: true
  });
}

module.exports = { BaseSmsProvider, notSupported, notImplemented };
