const test = require('node:test');
const assert = require('node:assert/strict');
const whatsappService = require('../src/services/whatsapp.service');
const { createTemplateSnapshot, renderTemplateSnapshot } = require('../src/services/templateMessage.service');
const { normalizeMessagePresentation } = require('../src/services/messagePresentation.service');

const template = { name: 'reminder_b', language: 'en_US', headerType: 'TEXT', headerContent: 'Seminar reminder', body: 'Hello {{1}}, your seminar starts at {{2}}.', footer: 'Academy', buttons: [{ type: 'QUICK_REPLY', text: 'Confirm' }, { type: 'URL', text: 'Details', url: 'https://example.test' }] };
const components = [{ type: 'body', parameters: [{ type: 'text', text: 'Piyumika' }, { type: 'text', text: '8:30 PM' }] }];

test('snapshot resolves body and preserves header footer buttons and components', () => {
  const snapshot = createTemplateSnapshot(template, components);
  assert.equal(snapshot.body, 'Hello Piyumika, your seminar starts at 8:30 PM.');
  assert.match(renderTemplateSnapshot(snapshot), /Seminar reminder[\s\S]*Hello Piyumika[\s\S]*Academy[\s\S]*Confirm · Details/);
  assert.deepEqual(snapshot.components, components);
});

test('CRM presentation prefers send-time snapshot and safely falls back to name', () => {
  const snapshot = createTemplateSnapshot(template, components);
  const rendered = normalizeMessagePresentation({ type: 'template', text: 'reminder_b', templateName: 'reminder_b', rawPayload: { templateSnapshot: snapshot } });
  assert.match(rendered.body, /Hello Piyumika/);
  assert.equal(rendered.templateDisplay.name, 'reminder_b');
  assert.equal(normalizeMessagePresentation({ type: 'template', text: null, templateName: 'legacy_name', rawPayload: {} }).body, 'legacy_name');
  assert.equal(normalizeMessagePresentation({ type: 'template', text: 'Hi {{1}}', templateName: 'legacy', rawPayload: { template: { components: [{ type: 'body', parameters: [{ type: 'text', text: 'Nimali' }] }] } } }).body, 'Hi Nimali');
});

test('Meta request remains a real template payload', async () => {
  const originalConfig = whatsappService.getRuntimeConfig;
  const originalRequest = whatsappService.sendRequest;
  let payload;
  whatsappService.getRuntimeConfig = async () => ({ phoneNumberId: 'phone-id', whatsappAccountId: 7 });
  whatsappService.sendRequest = async (value) => { payload = value; return { id: 'wamid.mock' }; };
  try {
    assert.equal((await whatsappService.sendTemplateMessage({ to: '94770000000', templateName: 'reminder_b', language: 'en_US', components, log: false })).id, 'wamid.mock');
    assert.deepEqual(payload, { messaging_product: 'whatsapp', to: '94770000000', type: 'template', template: { name: 'reminder_b', language: { code: 'en_US' }, components } });
  } finally {
    whatsappService.getRuntimeConfig = originalConfig;
    whatsappService.sendRequest = originalRequest;
  }
});

test('plain and interactive messages are unchanged', () => {
  assert.equal(normalizeMessagePresentation({ type: 'text', text: 'Hello', rawPayload: {} }).body, 'Hello');
  assert.equal(normalizeMessagePresentation({ type: 'interactive', text: 'Choose', rawPayload: { interactive: { body: 'Choose' } } }).body, 'Choose');
});
