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
    fields: ['mode', 'defaultMask', 'sandboxApiKey', 'liveApiKey'],
    secretFields: ['sandboxApiKey', 'liveApiKey']
  }
};
