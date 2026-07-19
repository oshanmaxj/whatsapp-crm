const test = require('node:test');
const assert = require('node:assert/strict');

const service = require('../src/services/whatsappAccount.service');
const whatsappService = require('../src/services/whatsapp.service');
const { WhatsAppAccount } = require('../src/models');

const config = {
  whatsappAccountId: 12,
  businessAccountId: '1111222233334444',
  phoneNumberId: '9999000011112222',
  appId: '5555666677778888',
  accessToken: 'account-token-that-must-never-leak',
  verifyToken: 'verify-token-that-must-never-leak',
  apiBaseUrl: 'https://graph.facebook.com',
  apiVersion: 'v25.0',
  status: 'active',
  sendEnabled: true
};

function appSubscription(override = null) {
  return {
    ...(override ? { override_callback_uri: override } : {}),
    whatsapp_business_api_data: { id: config.appId, name: 'CRM' }
  };
}

async function withMocks(runtimeConfig, graphRequest, callback) {
  const originalRuntime = service.runtimeConfig;
  const originalGraph = service.graphRequest;
  service.runtimeConfig = runtimeConfig;
  service.graphRequest = graphRequest;
  try {
    return await callback();
  } finally {
    service.runtimeConfig = originalRuntime;
    service.graphRequest = originalGraph;
  }
}

test('WABA not subscribed is reported without credential leakage', async () => {
  const diagnostic = await withMocks(
    async () => config,
    async (_config, method, objectId, edge) => {
      if (method === 'get' && objectId === config.businessAccountId && edge === '/subscribed_apps') return { data: { data: [] } };
      if (method === 'get' && objectId === config.phoneNumberId) return { data: { id: config.phoneNumberId } };
      throw new Error('unexpected request');
    },
    () => service.checkWebhookSubscription(12)
  );
  assert.equal(diagnostic.subscribed, false);
  assert.equal(diagnostic.connectionVerificationResult, 'CRM app is not subscribed');
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    'callbackSource', 'connectionVerificationResult', 'crmAppId', 'phoneNumberIdLastFour', 'subscribed', 'wabaIdLastFour'
  ]);
  const output = JSON.stringify(diagnostic);
  assert.equal(output.includes(config.accessToken), false);
  assert.equal(output.includes(config.verifyToken), false);
  assert.equal(output.includes(config.businessAccountId), false);
  assert.equal(output.includes(config.phoneNumberId), false);
});

test('Subscribe Webhook posts to the selected WABA and confirms the CRM app', async () => {
  let subscribed = false;
  let postCount = 0;
  const diagnostic = await withMocks(
    async (id) => ({ ...config, whatsappAccountId: id }),
    async (selected, method, objectId, edge, data) => {
      assert.equal(selected.accessToken, config.accessToken);
      if (objectId === config.businessAccountId && edge === '/subscribed_apps' && method === 'get') {
        return { data: { data: subscribed ? [appSubscription()] : [] } };
      }
      if (objectId === config.businessAccountId && edge === '/subscribed_apps' && method === 'post') {
        postCount += 1;
        assert.deepEqual(data, {});
        subscribed = true;
        return { data: { success: true } };
      }
      if (objectId === config.phoneNumberId && method === 'get') return { data: { id: config.phoneNumberId } };
      throw new Error('unexpected request');
    },
    () => service.subscribeWebhook(12)
  );
  assert.equal(postCount, 1);
  assert.equal(diagnostic.subscribed, true);
  assert.equal(diagnostic.connectionVerificationResult, 'verified');
});

test('Subscribe Webhook is idempotent when already subscribed', async () => {
  let postCount = 0;
  const diagnostic = await withMocks(
    async () => config,
    async (_selected, method, objectId, edge) => {
      if (method === 'post') postCount += 1;
      if (objectId === config.businessAccountId && edge === '/subscribed_apps') return { data: { data: [appSubscription()] } };
      if (objectId === config.phoneNumberId) return { data: { id: config.phoneNumberId } };
      throw new Error('unexpected request');
    },
    () => service.subscribeWebhook(12)
  );
  assert.equal(postCount, 0);
  assert.equal(diagnostic.subscribed, true);
});

test('old WhatChimp callback is warned and can be replaced without exposing verify token', async () => {
  let override = 'https://hooks.whatchimp.example/webhook';
  let sentPayload;
  const diagnostic = await withMocks(
    async () => config,
    async (_selected, method, objectId, edge, data) => {
      if (objectId === config.businessAccountId && edge === '/subscribed_apps' && method === 'get') {
        return { data: { data: [appSubscription(override)] } };
      }
      if (objectId === config.businessAccountId && edge === '/subscribed_apps' && method === 'post') {
        sentPayload = data;
        override = data.override_callback_uri;
        return { data: { success: true } };
      }
      if (objectId === config.phoneNumberId && method === 'get') return { data: { id: config.phoneNumberId } };
      throw new Error('unexpected request');
    },
    async () => {
      const before = await service.checkWebhookSubscription(12);
      assert.equal(before.connectionVerificationResult, 'warning: WhatChimp callback override detected');
      return service.overrideWebhookCallback(12);
    }
  );
  assert.deepEqual(sentPayload, {
    override_callback_uri: 'https://api.firstofsolutions.com/api/webhooks/whatsapp',
    verify_token: config.verifyToken
  });
  assert.equal(diagnostic.connectionVerificationResult, 'verified');
  assert.equal(JSON.stringify(diagnostic).includes(config.verifyToken), false);
});

test('multiple accounts use only the selected account token, WABA, and phone ID', async () => {
  const selected = { ...config, whatsappAccountId: 22, businessAccountId: '7000000000000022', phoneNumberId: '8000000000000022', accessToken: 'selected-account-token' };
  const seen = [];
  const diagnostic = await withMocks(
    async (id) => {
      assert.equal(Number(id), 22);
      return selected;
    },
    async (resolved, method, objectId, edge) => {
      seen.push({ token: resolved.accessToken, objectId, edge });
      if (objectId === selected.businessAccountId) return { data: { data: [appSubscription()] } };
      if (objectId === selected.phoneNumberId) return { data: { id: selected.phoneNumberId } };
      throw new Error(`unexpected ${method}`);
    },
    () => service.checkWebhookSubscription(22)
  );
  assert.equal(diagnostic.phoneNumberIdLastFour, '0022');
  assert.deepEqual(seen.map((item) => item.token), ['selected-account-token', 'selected-account-token']);
  assert.deepEqual(seen.map((item) => item.objectId), [selected.businessAccountId, selected.phoneNumberId]);
});

test('public account serialization never returns credentials or credential fragments', async () => {
  const originalGet = service.get;
  service.get = async () => ({
    toJSON: () => ({ id: 12, name: 'CRM', accessTokenEncrypted: 'enc:ciphertext', appSecretEncrypted: 'enc:secret', webhookVerifyToken: config.verifyToken }),
    accessTokenEncrypted: 'enc:ciphertext', appSecretEncrypted: 'enc:secret', webhookVerifyToken: config.verifyToken
  });
  try {
    const result = await service.getPublic(12);
    const output = JSON.stringify(result);
    assert.equal(output.includes('ciphertext'), false);
    assert.equal(output.includes(config.verifyToken), false);
    assert.equal('accessToken' in result, false);
    assert.equal('appSecret' in result, false);
    assert.equal(result.webhookVerifyTokenConfigured, true);
  } finally {
    service.get = originalGet;
  }
});

test('inbound messages field passes exact phone metadata to account mapping', async () => {
  const original = whatsappService.handleInboundMessage;
  let mapped;
  whatsappService.handleInboundMessage = async (value, message) => { mapped = { value, message }; };
  try {
    await whatsappService.processWebhook({ entry: [{ changes: [
      { field: 'account_alerts', value: { messages: [{ id: 'ignored' }] } },
      { field: 'messages', value: { metadata: { phone_number_id: config.phoneNumberId }, messages: [{ id: 'wamid.inbound' }] } }
    ] }] });
    assert.equal(mapped.value.metadata.phone_number_id, config.phoneNumberId);
    assert.equal(mapped.message.id, 'wamid.inbound');
  } finally {
    whatsappService.handleInboundMessage = original;
  }
});

test('inbound account resolver selects the exact account and canonical thread', async () => {
  const originalRuntime = whatsappService.getRuntimeConfig;
  let requested;
  whatsappService.getRuntimeConfig = async (accountId, options) => {
    requested = { accountId, options };
    return { ...config, whatsappAccountId: 12 };
  };
  try {
    const resolved = await whatsappService.resolveInboundAccount({ metadata: { phone_number_id: config.phoneNumberId } }, 'wamid.map');
    assert.deepEqual(requested, { accountId: null, options: { phoneNumberId: config.phoneNumberId } });
    assert.equal(resolved.whatsappAccountId, 12);
    assert.equal(whatsappService.canonicalInboundThreadId(resolved.whatsappAccountId, '+94 77 577 7686'), '12:94775777686');
  } finally {
    whatsappService.getRuntimeConfig = originalRuntime;
  }
});
