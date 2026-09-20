// The ONLY module business logic (single sends, campaigns, bulk sends, fee
// reminders, class reminders, birthday wishes, attendance alerts, reminder
// sequences, queues/workers) is allowed to call for sending SMS. It never
// knows which provider is active — that's resolved per-call from
// smsGatewaySettings.service.js and instantiated via smsProviderFactory.js.
// Swapping or adding a provider never requires a change here.
const settingsService = require('../smsGatewaySettings.service');
const factory = require('./smsProviderFactory');

function notConfigured(providerName) {
  return Object.assign(new Error(`The ${providerName} SMS provider is not configured.`), {
    status: 409, code: 'SMS_PROVIDER_NOT_CONFIGURED', exposeMessage: true
  });
}

async function resolveProvider() {
  const config = await settingsService.getRuntimeConfig();
  if (!config.isEnabled) throw Object.assign(new Error('SMS sending is disabled. Enable it in SMS Gateway settings first.'), { status: 409, code: 'SMS_GATEWAY_DISABLED', exposeMessage: true });
  const provider = factory.createProvider(config.activeProvider, config.providerConfig);
  if (!provider.isConfigured) throw notConfigured(config.activeProvider);
  return { provider, providerName: config.activeProvider, config };
}

async function sendSms({ to, message, mask, campaignName }) {
  const { provider, providerName, config } = await resolveProvider();
  const resolvedMask = mask || config.providerConfig.defaultMask || null;
  try {
    const result = await provider.sendSms({ to, message, mask: resolvedMask, campaignName });
    return { provider: providerName, mask: resolvedMask, ...result };
  } catch (error) {
    if (!error.provider) error.provider = providerName;
    throw error;
  }
}

// Falls back to individual sendSms() calls when the active provider has no
// bulk endpoint (capability-detection per provider, not an assumption that
// every gateway offers one).
async function sendBulkSms({ messages }) {
  const { provider, providerName, config } = await resolveProvider();
  if (provider.capabilities.bulk) {
    const results = await provider.sendBulkSms({ messages });
    return results.map((entry) => ({ provider: providerName, ...entry }));
  }

  const resolvedDefaultMask = config.providerConfig.defaultMask || null;
  const results = [];
  for (const entry of messages) {
    try {
      const sent = await provider.sendSms({ to: entry.to, message: entry.message, mask: entry.mask || resolvedDefaultMask });
      results.push({ provider: providerName, to: entry.to, ...sent });
    } catch (error) {
      results.push({ provider: providerName, to: entry.to, error: error.message });
    }
  }
  return results;
}

module.exports = { sendSms, sendBulkSms };
