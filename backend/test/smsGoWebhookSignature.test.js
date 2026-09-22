const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const SmsGoProvider = require('../src/services/sms/providers/smsgo.provider');
const registry = require('../src/services/sms/providers/registry');

// --- registry: the webhook secret is a distinct, encrypted config field -----

test('registry.js declares webhookSecret as its own field, separate from the send API keys, and marks it a secret (encrypted at rest, never returned to the frontend)', () => {
  const { fields, secretFields } = registry.smsgo;
  assert.ok(fields.includes('webhookSecret'));
  assert.ok(secretFields.includes('webhookSecret'));
  assert.ok(secretFields.includes('sandboxApiKey') && secretFields.includes('liveApiKey'), 'existing send-key secrecy must be unaffected');
});

// --- verifyWebhookSignature: correct scheme per SMSGo's published SDK docs --

function sign(secret, rawBody) {
  return `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

test('a correctly signed webhook (sha256=<hex> keyed with the dedicated webhookSecret) is accepted', () => {
  const provider = new SmsGoProvider({ mode: 'live', liveApiKey: 'send-key-should-be-irrelevant', webhookSecret: 'whsec_test123' });
  const rawBody = Buffer.from(JSON.stringify({ event: 'sms.status_update', data: { status: 'delivered' } }));
  const headers = { 'x-smsgo-signature': sign('whsec_test123', rawBody) };

  assert.equal(provider.verifyWebhookSignature({ headers, rawBody }), true);
});

test('the OLD bug is fixed: a signature computed with the send API key (instead of webhookSecret) is now correctly REJECTED, not silently trusted', () => {
  const provider = new SmsGoProvider({ mode: 'live', liveApiKey: 'send-key-should-be-irrelevant', webhookSecret: 'whsec_test123' });
  const rawBody = Buffer.from(JSON.stringify({ event: 'sms.status_update' }));
  // Exactly what the pre-fix code computed and compared.
  const oldStyleSignature = crypto.createHmac('sha256', 'send-key-should-be-irrelevant').update(rawBody).digest('hex');
  const headers = { 'x-smsgo-signature': oldStyleSignature };

  assert.equal(provider.verifyWebhookSignature({ headers, rawBody }), false);
});

test('the OLD bug is fixed: a real, correctly-keyed signature WITHOUT the documented "sha256=" prefix is rejected (the pre-fix code compared raw hex with no prefix handling)', () => {
  const provider = new SmsGoProvider({ mode: 'live', liveApiKey: 'irrelevant', webhookSecret: 'whsec_test123' });
  const rawBody = Buffer.from(JSON.stringify({ event: 'sms.status_update' }));
  const bareHex = crypto.createHmac('sha256', 'whsec_test123').update(rawBody).digest('hex');
  const headers = { 'x-smsgo-signature': bareHex };

  assert.equal(provider.verifyWebhookSignature({ headers, rawBody }), false);
});

test('a correctly-formatted signature with the WRONG secret is rejected', () => {
  const provider = new SmsGoProvider({ mode: 'live', webhookSecret: 'whsec_correct' });
  const rawBody = Buffer.from(JSON.stringify({ event: 'x' }));
  const headers = { 'x-smsgo-signature': sign('whsec_wrong', rawBody) };

  assert.equal(provider.verifyWebhookSignature({ headers, rawBody }), false);
});

test('fails closed (rejects) when no webhookSecret is configured at all, rather than falling back to the API key or accepting unsigned traffic', () => {
  const provider = new SmsGoProvider({ mode: 'live', liveApiKey: 'some-key' });
  const rawBody = Buffer.from(JSON.stringify({ event: 'x' }));
  const headers = { 'x-smsgo-signature': sign('some-key', rawBody) };

  assert.equal(provider.verifyWebhookSignature({ headers, rawBody }), false);
});

test('missing signature header or missing raw body is rejected without throwing', () => {
  const provider = new SmsGoProvider({ webhookSecret: 'whsec_x' });
  assert.equal(provider.verifyWebhookSignature({ headers: {}, rawBody: Buffer.from('{}') }), false);
  assert.equal(provider.verifyWebhookSignature({ headers: { 'x-smsgo-signature': 'sha256=abc' }, rawBody: null }), false);
});

test('a malformed signature header (not matching sha256=<hex>) is rejected, not thrown on', () => {
  const provider = new SmsGoProvider({ webhookSecret: 'whsec_x' });
  const rawBody = Buffer.from('{}');
  assert.doesNotThrow(() => provider.verifyWebhookSignature({ headers: { 'x-smsgo-signature': 'not-a-real-signature' }, rawBody }));
  assert.equal(provider.verifyWebhookSignature({ headers: { 'x-smsgo-signature': 'not-a-real-signature' }, rawBody }), false);
});

test('signature comparison is case-insensitive on the hex digits (uppercase hex from the provider still verifies)', () => {
  const provider = new SmsGoProvider({ webhookSecret: 'whsec_case' });
  const rawBody = Buffer.from('{"a":1}');
  const hex = crypto.createHmac('sha256', 'whsec_case').update(rawBody).digest('hex');
  const headers = { 'x-smsgo-signature': `sha256=${hex.toUpperCase()}` };

  assert.equal(provider.verifyWebhookSignature({ headers, rawBody }), true);
});
