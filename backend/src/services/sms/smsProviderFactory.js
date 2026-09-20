const registry = require('./providers/registry');

function listProviders() {
  return Object.entries(registry).map(([id, entry]) => ({ id, label: entry.label }));
}

function getProviderDescriptor(name) {
  const entry = registry[name];
  if (!entry) throw Object.assign(new Error(`Unknown SMS provider "${name}".`), { status: 500, code: 'SMS_PROVIDER_UNKNOWN' });
  return entry;
}

// Deliberately takes the resolved provider config as a plain argument
// rather than reaching into settings storage itself — this keeps the
// factory a pure lookup with no dependency on smsGatewaySettings.service.js,
// which is what lets that settings service depend on the factory (to build
// a provider instance for testing) without a require cycle.
function createProvider(name, config) {
  const { ProviderClass } = getProviderDescriptor(name);
  return new ProviderClass(config || {});
}

module.exports = { listProviders, getProviderDescriptor, createProvider };
