const test = require('node:test');
const assert = require('node:assert/strict');
const { createService, THROTTLE_MS } = require('../src/services/whatsappTypingIndicator.service');
const whatsappService = require('../src/services/whatsapp.service');

const conversation = { id: 7, contactId: 8, whatsappAccountId: 9 };
const inbound = { id: 10, whatsappMessageId: 'wamid.inbound.latest', createdAt: new Date() };

function setup(overrides = {}) {
  const calls = [];
  let current = 1_000;
  const service = createService({
    Conversation: { findByPk: async () => conversation },
    Message: { findOne: async ({ where }) => where.direction === 'inbound' ? inbound : null },
    messagingWindowService: { getMessagingWindow: async () => ({ isOpen: true }) },
    whatsappService: { sendTypingIndicator: async payload => { calls.push(payload); return { success: true }; } },
    logger: { warn() {} },
    now: () => current,
    ...overrides
  });
  return { service, calls, advance: value => { current += value; } };
}

test('uses the exact account and latest inbound WAMID, then throttles the conversation', async () => {
  const { service, calls, advance } = setup();
  assert.equal((await service.sendWhatsAppTypingIndicator({ conversationId: 7, whatsappAccountId: 9 })).status, 'sent');
  assert.deepEqual(calls[0], {
    whatsappAccountId: 9, inboundWhatsappMessageId: 'wamid.inbound.latest', conversationId: 7, flowRunId: null
  });
  assert.equal((await service.sendWhatsAppTypingIndicator({ conversationId: 7, whatsappAccountId: 9 })).status, 'skipped_throttled');
  advance(THROTTLE_MS);
  assert.equal((await service.sendWhatsAppTypingIndicator({ conversationId: 7, whatsappAccountId: 9 })).status, 'sent');
});

test('never selects an outbound message and falls back when a trigger WAMID is invalid', async () => {
  const queries = [];
  const { service, calls } = setup({ Message: { findOne: async query => { queries.push(query); return queries.length === 1 ? null : inbound; } } });
  const result = await service.sendWhatsAppTypingIndicator({ conversationId: 7, whatsappAccountId: 9, inboundWhatsappMessageId: 'wamid.outbound' });
  assert.equal(result.status, 'sent');
  assert.equal(queries.every(query => query.where.direction === 'inbound'), true);
  assert.equal(calls[0].inboundWhatsappMessageId, inbound.whatsappMessageId);
});

test('closed windows and missing inbound messages skip Meta', async () => {
  const closed = setup({ messagingWindowService: { getMessagingWindow: async () => ({ isOpen: false }) } });
  assert.equal((await closed.service.sendWhatsAppTypingIndicator({ conversationId: 7, whatsappAccountId: 9 })).status, 'skipped_window_closed');
  assert.equal(closed.calls.length, 0);

  const missing = setup({ Message: { findOne: async () => null } });
  assert.equal((await missing.service.sendWhatsAppTypingIndicator({ conversationId: 7, whatsappAccountId: 9 })).status, 'skipped_no_inbound_message');
  assert.equal(missing.calls.length, 0);
});

test('account mismatch and Meta failures are non-fatal structured results', async () => {
  const mismatch = setup();
  assert.equal((await mismatch.service.sendWhatsAppTypingIndicator({ conversationId: 7, whatsappAccountId: 99 })).status, 'failed');
  const failed = setup({ whatsappService: { sendTypingIndicator: async () => ({ success: false }) } });
  assert.equal((await failed.service.sendWhatsAppTypingIndicator({ conversationId: 7, whatsappAccountId: 9 })).status, 'failed');
});

test('low-level sender uses Meta exact typing payload and selected account config', async () => {
  const originals = { config: whatsappService.getWhatsAppConfig, request: whatsappService.sendRequest };
  let payload; let options;
  whatsappService.getWhatsAppConfig = async accountId => ({
    whatsappAccountId: accountId, phoneNumberId: accountId === 9 ? '111111' : '222222',
    accessToken: accountId === 9 ? 'token-nine' : 'token-other', apiVersion: 'v23.0'
  });
  whatsappService.sendRequest = async (body, requestOptions) => { payload = body; options = requestOptions; return { success: true }; };
  try {
    await whatsappService.sendTypingIndicator({ whatsappAccountId: 9, inboundWhatsappMessageId: 'wamid.inbound', conversationId: 7 });
    assert.deepEqual(payload, {
      messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.inbound', typing_indicator: { type: 'text' }
    });
    assert.equal(options.config.phoneNumberId, '111111');
    assert.equal(options.config.accessToken, 'token-nine');
  } finally {
    whatsappService.getWhatsAppConfig = originals.config;
    whatsappService.sendRequest = originals.request;
  }
});
