const test = require('node:test');
const assert = require('node:assert/strict');
const whatsapp = require('../src/services/whatsapp.service');

test('typing indicator uses the inbound message and account-scoped Cloud API payload', async () => {
  const originalConfig = whatsapp.getWhatsAppConfig;
  const originalSend = whatsapp.sendRequest;
  let captured;
  whatsapp.getWhatsAppConfig = async id => ({ whatsappAccountId: id, accessToken: 'test', phoneNumberId: '123', apiBaseUrl: 'https://graph.facebook.com', apiVersion: 'v23.0' });
  whatsapp.sendRequest = async (payload, options) => { captured = { payload, options }; return { success: true }; };
  try {
    const result = await whatsapp.sendTypingIndicator({ whatsappAccountId: 7, inboundWhatsappMessageId: 'wamid.inbound' });
    assert.equal(result.success, true);
    assert.deepEqual(captured.payload, { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.inbound', typing_indicator: { type: 'text' } });
    assert.equal(captured.options.config.whatsappAccountId, 7);
  } finally { whatsapp.getWhatsAppConfig = originalConfig; whatsapp.sendRequest = originalSend; }
});

test('typing failure is non-blocking and missing inbound identity is skipped', async () => {
  assert.deepEqual(await whatsapp.sendTypingIndicator({ whatsappAccountId: 7 }), { skipped: true });
  const originalConfig = whatsapp.getWhatsAppConfig;
  const originalSend = whatsapp.sendRequest;
  whatsapp.getWhatsAppConfig = async id => ({ whatsappAccountId: id, accessToken: 'test', phoneNumberId: '123', apiBaseUrl: 'https://graph.facebook.com', apiVersion: 'v23.0' });
  whatsapp.sendRequest = async () => { throw Object.assign(new Error('Meta unavailable'), { response: { status: 500, data: {} } }); };
  try { assert.deepEqual(await whatsapp.sendTypingIndicator({ whatsappAccountId: 7, inboundWhatsappMessageId: 'wamid.retry' }), { success: false }); }
  finally { whatsapp.getWhatsAppConfig = originalConfig; whatsapp.sendRequest = originalSend; }
});
