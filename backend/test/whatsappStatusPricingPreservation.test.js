const test = require('node:test');
const assert = require('node:assert/strict');
const models = require('../src/models');
const whatsappService = require('../src/services/whatsapp.service');

const originals = {
  messageFindOne: models.Message.findOne,
  reminderFindOne: models.ReminderExecution.findOne
};
test.afterEach(() => {
  models.Message.findOne = originals.messageFindOne;
  models.ReminderExecution.findOne = originals.reminderFindOne;
});

function fakeExistingMessage(overrides = {}) {
  const record = {
    id: 501, conversationId: null, whatsappAccountId: 7, rawPayload: {},
    ...overrides,
    async update(patch) { Object.assign(this, patch); this.updateCalls = (this.updateCalls || []).concat([patch]); return this; }
  };
  return record;
}

test('a status update carrying a pricing object records it on the message (scenario 15 setup)', async () => {
  const existing = fakeExistingMessage();
  models.Message.findOne = async () => existing;
  models.ReminderExecution.findOne = async () => null;

  await whatsappService.handleStatusUpdate({}, {
    id: 'wamid.1', status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)),
    pricing: { category: 'utility', pricing_model: 'PMP', billable: true }
  });

  assert.equal(existing.pricingCategory, 'utility');
  assert.equal(existing.pricingModel, 'PMP');
  assert.equal(existing.pricingBillable, true);
});

test('a later, delayed status update with NO pricing object does not erase a previously-recorded pricing value (scenario 15)', async () => {
  // Simulates exactly the out-of-order-delivery case Part 8/14 calls out:
  // the "delivered" receipt arrived first (with pricing), and a delayed
  // "sent" receipt for the same message arrives afterward with none.
  const existing = fakeExistingMessage({ pricingCategory: 'utility', pricingModel: 'PMP', pricingBillable: true, status: 'delivered' });
  models.Message.findOne = async () => existing;
  models.ReminderExecution.findOne = async () => null;

  await whatsappService.handleStatusUpdate({}, { id: 'wamid.1', status: 'sent', timestamp: String(Math.floor(Date.now() / 1000)) });

  assert.equal(existing.pricingCategory, 'utility', 'pricing category must survive a status update with no pricing object');
  assert.equal(existing.pricingModel, 'PMP');
  assert.equal(existing.pricingBillable, true);
  // The status itself still moves per the webhook's own semantics — only
  // pricing is protected from being clobbered by an absent field.
  assert.equal(existing.status, 'sent');
});

test('a failed status is recorded as failed, never silently treated as delivered (scenario 16)', async () => {
  const existing = fakeExistingMessage();
  models.Message.findOne = async () => existing;
  models.ReminderExecution.findOne = async () => null;

  await whatsappService.handleStatusUpdate({}, {
    id: 'wamid.2', status: 'failed', timestamp: String(Math.floor(Date.now() / 1000)),
    errors: [{ code: 131026, message: 'Message undeliverable' }]
  });

  assert.equal(existing.status, 'failed');
  assert.equal(existing.errorCode, '131026');
});
