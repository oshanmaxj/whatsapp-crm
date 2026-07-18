const test = require('node:test');
const assert = require('node:assert/strict');

const whatsappService = require('../src/services/whatsapp.service');
const whatsappAccountService = require('../src/services/whatsappAccount.service');
const logger = require('../src/config/logger');
const webhookController = require('../src/controllers/webhook.controller');

const validConfig = {
  whatsappAccountId: 7,
  accessToken: 'secret-value',
  phoneNumberId: '123456789',
  apiVersion: 'v25.0',
  apiBaseUrl: 'https://graph.facebook.com',
  status: 'active',
  connectionStatus: 'connected',
  sendEnabled: true
};

test('invalid phone number ID is rejected before a Meta request', async () => {
  let requested = false;
  const original = whatsappService.requestClient;
  whatsappService.requestClient = async () => { requested = true; return {}; };
  await assert.rejects(
    whatsappService.sendRequest({ to: '94771234567', type: 'text' }, { config: { ...validConfig, phoneNumberId: 'PHONE_NUMBER_ID' } }),
    { code: 'WHATSAPP_CONFIGURATION_INVALID' }
  );
  assert.equal(requested, false);
  whatsappService.requestClient = original;
});

test('missing token is rejected safely', async () => {
  await assert.rejects(
    whatsappService.sendRequest({ to: '94771234567', type: 'text' }, { config: { ...validConfig, accessToken: '' } }),
    (error) => error.code === 'WHATSAPP_CONFIGURATION_INVALID' && !error.message.includes('secret-value')
  );
});

test('template send posts to the selected phone number messages endpoint', async () => {
  const originalClient = whatsappService.requestClient;
  const originalRetry = whatsappService.retryRequest;
  let request;
  whatsappService.requestClient = async (config) => ({
    config,
    client: { post: async (path, payload) => { request = { path, payload, baseURL: `${config.apiBaseUrl}/${config.apiVersion}/${config.phoneNumberId}` }; return { data: { messages: [{ id: 'wamid.1' }] } }; } }
  });
  whatsappService.retryRequest = async (callback) => callback();
  const response = await whatsappService.sendRequest({
    messaging_product: 'whatsapp', to: '+94 77 123 4567', type: 'template',
    template: { name: 'approved_template', language: { code: 'en_US' } }
  }, { config: validConfig });
  assert.equal(response.id, 'wamid.1');
  assert.equal(request.path, '/messages');
  assert.equal(request.baseURL, 'https://graph.facebook.com/v25.0/123456789');
  assert.equal(request.payload.to, '94771234567');
  whatsappService.requestClient = originalClient;
  whatsappService.retryRequest = originalRetry;
});

test('conversation-linked account resolution stays atomic', async () => {
  const original = whatsappAccountService.runtimeConfig;
  whatsappAccountService.runtimeConfig = async (id) => ({ ...validConfig, whatsappAccountId: id, configurationSource: 'whatsapp_account' });
  const resolved = await whatsappService.getRuntimeConfig(42);
  assert.equal(resolved.whatsappAccountId, 42);
  assert.equal(resolved.accessToken, validConfig.accessToken);
  assert.equal(resolved.phoneNumberId, validConfig.phoneNumberId);
  assert.equal(resolved.configurationSource, 'whatsapp_account');
  whatsappAccountService.runtimeConfig = original;
});

test('normal text and media sends use the same selected account resolver', async () => {
  const originalConfig = whatsappService.getWhatsAppConfig;
  const originalSend = whatsappService.sendRequest;
  const selected = [];
  whatsappService.getWhatsAppConfig = async (accountId) => { selected.push(accountId); return validConfig; };
  whatsappService.sendRequest = async (payload, options) => {
    assert.equal(options.config.whatsappAccountId, 7);
    return { id: `wamid.${payload.type}` };
  };
  await whatsappService.sendTextMessage({ to: '94771234567', text: 'hello', whatsappAccountId: 7, log: false });
  await whatsappService.sendMediaMessage({ to: '94771234567', mediaType: 'image', mediaId: 'media-1', whatsappAccountId: 7, log: false });
  assert.deepEqual(selected, [7, 7]);
  whatsappService.getWhatsAppConfig = originalConfig;
  whatsappService.sendRequest = originalSend;
});

test('Meta code 100 subcode 33 disconnects account and exposes no token', async () => {
  const originalClient = whatsappService.requestClient;
  const originalRetry = whatsappService.retryRequest;
  const originalMark = whatsappAccountService.markDisconnected;
  let disconnected;
  whatsappService.requestClient = async () => ({ client: { post: async () => null } });
  whatsappService.retryRequest = async () => {
    const error = new Error('Graph rejected request');
    error.response = { status: 400, data: { error: { code: 100, error_subcode: 33, message: 'Unsupported post request' } } };
    throw error;
  };
  whatsappAccountService.markDisconnected = async (id, message) => { disconnected = { id, message }; };
  await assert.rejects(
    whatsappService.sendRequest({ to: '94771234567', type: 'text' }, { config: validConfig }),
    (error) => error.code === 'WHATSAPP_PHONE_NUMBER_INACCESSIBLE' && !error.message.includes(validConfig.accessToken)
  );
  assert.equal(disconnected.id, 7);
  whatsappService.requestClient = originalClient;
  whatsappService.retryRequest = originalRetry;
  whatsappAccountService.markDisconnected = originalMark;
});

test('logger redacts tokens and authorization headers recursively', () => {
  const redacted = logger.redact({ Authorization: 'Bearer abc.def', nested: { access_token: 'top-secret' }, message: 'OAuth another-secret' });
  assert.equal(redacted.Authorization, '[REDACTED]');
  assert.equal(redacted.nested.access_token, '[REDACTED]');
  assert.equal(redacted.message, '[REDACTED]');
});

test('webhook signature verification uses the configured app secret', () => {
  const crypto = require('crypto');
  const raw = Buffer.from('{"object":"whatsapp_business_account"}');
  const secret = 'app-secret';
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  assert.equal(webhookController.signatureMatches(raw, signature, secret), true);
  assert.equal(webhookController.signatureMatches(raw, `${signature.slice(0, -1)}0`, secret), false);
});

test('unknown inbound phone number ID is acknowledged without processing', async () => {
  const { Message, Notification } = require('../src/models');
  const originalFind = Message.findOne;
  const originalCreate = Notification.create;
  const originalConfig = whatsappService.getRuntimeConfig;
  let diagnostic;
  Message.findOne = async () => null;
  Notification.create = async (payload) => { diagnostic = payload; return payload; };
  whatsappService.getRuntimeConfig = async () => { throw Object.assign(new Error('not found'), { status: 404 }); };
  const result = await whatsappService.handleInboundMessage(
    { metadata: { phone_number_id: '99998888' } },
    { id: 'wamid.unknown', from: '94771234567', type: 'text', text: { body: 'hello' }, timestamp: '1700000000' }
  );
  assert.equal(result, null);
  assert.equal(diagnostic.data.phoneNumberIdLastFour, '8888');
  assert.equal(JSON.stringify(diagnostic).includes('99998888'), false);
  Message.findOne = originalFind;
  Notification.create = originalCreate;
  whatsappService.getRuntimeConfig = originalConfig;
});

test('webhook retry does not duplicate an existing inbound message', async () => {
  const { Message } = require('../src/models');
  const existing = { id: 91, conversationId: 12 };
  const originalFind = Message.findOne;
  const originalConfig = whatsappService.getRuntimeConfig;
  let resolved = false;
  Message.findOne = async () => existing;
  whatsappService.getRuntimeConfig = async () => { resolved = true; return validConfig; };
  const result = await whatsappService.handleInboundMessage(
    { metadata: { phone_number_id: validConfig.phoneNumberId } },
    { id: 'wamid.duplicate', from: '94771234567', type: 'text', text: { body: 'hello' }, timestamp: '1700000000' }
  );
  assert.equal(result, existing);
  assert.equal(resolved, false);
  Message.findOne = originalFind;
  whatsappService.getRuntimeConfig = originalConfig;
});

test('WhatsApp connection migration is additive and idempotent', async () => {
  const migration = require('../migrations/037_whatsapp_connection_verification');
  const Sequelize = require('sequelize');
  const tables = { whatsapp_accounts: {}, messages: {} };
  const queryInterface = {
    describeTable: async (table) => ({ ...tables[table] }),
    addColumn: async (table, column, definition) => { tables[table][column] = definition; },
    removeColumn: async (table, column) => { delete tables[table][column]; }
  };
  await migration.up(queryInterface, Sequelize);
  await migration.up(queryInterface, Sequelize);
  assert.deepEqual(Object.keys(tables.whatsapp_accounts).sort(), ['connection_error', 'connection_status', 'last_verified_at', 'quality_rating', 'send_enabled', 'verified_name']);
  assert.deepEqual(Object.keys(tables.messages), ['error_subcode']);
});
