const SmsGoProvider = require('./smsgo.provider');

// Adding a new SMS provider means adding one entry here (plus the adapter
// file itself) — nothing else in the codebase needs to change. `fields` is
// every setting the provider's config block accepts; `secretFields` is the
// subset smsGatewaySettings.service.js encrypts at rest and never returns
// to the frontend, generically, without needing to know what SMSGo (or any
// other provider) actually is.
module.exports = {
  smsgo: {
    ProviderClass: SmsGoProvider,
    label: 'SMSGo.lk',
    // webhookSecret: a SEPARATE credential from sandboxApiKey/liveApiKey —
    // confirmed via SMSGo's own published Go SDK docs (pkg.go.dev), which
    // document it as obtained via Client.SetWebhook() (format `whsec_...`)
    // and used to verify "X-SMSGo-Signature: sha256=<hmac>" on incoming
    // webhooks. The send API key was never the right secret for this — see
    // smsgo.provider.js verifyWebhookSignature() for the incident notes.
    fields: ['mode', 'defaultMask', 'sandboxApiKey', 'liveApiKey', 'webhookSecret'],
    secretFields: ['sandboxApiKey', 'liveApiKey', 'webhookSecret']
  }
};
