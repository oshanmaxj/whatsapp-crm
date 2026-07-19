const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCanonicalWhatsappConversationService } = require('../src/services/canonicalWhatsappConversation.service');
const { createOutboundHistoryService } = require('../src/services/outboundHistory.service');
const { createPaymentReceiptDeliveryService } = require('../src/services/paymentReceiptDelivery.service');

function row(values) {
  return {
    ...values,
    async update(next) { Object.assign(this, next); return this; },
    toJSON() { return { ...this }; }
  };
}

function harness(overrides = {}) {
  const created = [];
  const transaction = { LOCK: { UPDATE: 'UPDATE' } };
  const conversations = overrides.conversations || [];
  const Conversation = {
    async findByPk(id) { return conversations.find((item) => String(item.id) === String(id)) || null; },
    async findAll() { return overrides.accounts || []; },
    async findOne() { return overrides.findOne ? overrides.findOne() : conversations.find((item) => ['open', 'pending'].includes(item.status)) || null; },
    async create(values) { const value = row({ id: 100 + created.length, ...values }); created.push(value); conversations.push(value); return value; }
  };
  const sequelize = overrides.sequelize || { getDialect: () => 'sqlite', transaction: (callback) => callback(transaction) };
  return {
    created, conversations, service: createCanonicalWhatsappConversationService({
      sequelize, Conversation,
      Message: { findByPk: async (id) => overrides.sourceMessages?.[id] || null },
      PaymentSlip: { findByPk: async (id) => overrides.paymentSlips?.[id] || null },
      Contact: { findByPk: async (id) => row({ id, phone: '94770000123', whatsappId: '94770000123' }) }
    })
  };
}

test('preferred explicit payment conversation wins', async () => {
  const conversation = row({ id: 7, contactId: 2, whatsappAccountId: 3, status: 'open' });
  const { service } = harness({ conversations: [conversation] });
  assert.equal((await service.resolveCanonicalWhatsAppConversation({ preferredConversationId: 7, contactId: 2, whatsappAccountId: 3 })).id, 7);
});

test('source inbound message conversation is reused', async () => {
  const conversation = row({ id: 8, contactId: 2, whatsappAccountId: 3, status: 'open' });
  const { service } = harness({ conversations: [conversation], sourceMessages: { 11: { conversationId: 8, contactId: 2, whatsappAccountId: 3 } } });
  assert.equal((await service.resolveCanonicalWhatsAppConversation({ sourceMessageId: 11 })).id, 8);
});

test('payment slip conversation survives acknowledgement queue resolution', async () => {
  const conversation = row({ id: 9, contactId: 2, whatsappAccountId: 3, status: 'open' });
  const { service } = harness({ conversations: [conversation], paymentSlips: { 5: { conversationId: 9, contactId: 2, whatsappAccountId: 3 } } });
  assert.equal((await service.resolveCanonicalWhatsAppConversation({ paymentSlipId: 5 })).id, 9);
});

test('same contact on two WhatsApp accounts requires an account', async () => {
  const { service } = harness({ accounts: [{ whatsappAccountId: 3 }, { whatsappAccountId: 4 }] });
  await assert.rejects(() => service.resolveCanonicalWhatsAppConversation({ contactId: 2 }), { code: 'WHATSAPP_ACCOUNT_AMBIGUOUS' });
});

test('contact and account identity does not cross accounts', async () => {
  const wrong = row({ id: 1, contactId: 2, whatsappAccountId: 4, status: 'open' });
  const right = row({ id: 2, contactId: 2, whatsappAccountId: 3, status: 'open' });
  const { service } = harness({ conversations: [wrong, right], findOne: () => right });
  assert.equal((await service.resolveCanonicalWhatsAppConversation({ contactId: 2, whatsappAccountId: 3 })).id, 2);
});

test('recent closed identity is reopened instead of duplicated', async () => {
  const closed = row({ id: 4, contactId: 2, whatsappAccountId: 3, status: 'closed' });
  let calls = 0;
  const { service, created } = harness({ conversations: [closed], findOne: () => (++calls === 1 ? null : closed) });
  const result = await service.resolveCanonicalWhatsAppConversation({ contactId: 2, whatsappAccountId: 3 });
  assert.equal(result.id, 4); assert.equal(result.status, 'open'); assert.equal(created.length, 0);
});

test('a conversation is created only when no account identity exists', async () => {
  const { service, created } = harness({ conversations: [], findOne: () => null });
  const result = await service.resolveCanonicalWhatsAppConversation({ contactId: 2, whatsappAccountId: 3 });
  assert.equal(result.id, 100); assert.equal(created.length, 1);
});

test('concurrent payment notifications remain idempotent', async () => {
  const conversations = [];
  let chain = Promise.resolve();
  const sequelize = { getDialect: () => 'sqlite', transaction(callback) {
    const run = chain.then(() => callback({ LOCK: { UPDATE: 'UPDATE' } })); chain = run.catch(() => {}); return run;
  } };
  const h = harness({ conversations, sequelize, findOne: () => conversations[0] || null });
  const results = await Promise.all([1, 2].map(() => h.service.resolveCanonicalWhatsAppConversation({ contactId: 2, whatsappAccountId: 3 })));
  assert.equal(results[0].id, results[1].id); assert.equal(h.created.length, 1);
});

test('outbound message is pending before Meta and completed in the same conversation', async () => {
  const messages = [];
  const conversation = row({ id: 7, contactId: 2, whatsappAccountId: 3, status: 'open' });
  const events = [];
  const service = createOutboundHistoryService({
    Contact: { findByPk: async () => ({ id: 2, phone: '94770000123' }) },
    Message: { findByPk: async () => null, findOne: async () => null, create: async (values) => { const value = row({ id: 20, ...values }); messages.push(value); return value; } },
    canonicalConversationService: { resolveCanonicalWhatsAppConversation: async () => conversation },
    socketService: { emitToRoom: (...args) => events.push(args), emitToConversationAudience: async (...args) => events.push(args) },
    logger: { warn() {} }
  });
  const prepared = await service.prepare({ phone: '94770000123', contactId: 2, conversationId: 7, whatsappAccountId: 3, text: 'confirmed' });
  assert.equal(messages[0].status, 'pending'); assert.equal(messages[0].conversationId, 7);
  await service.complete(prepared, { whatsappMessageId: 'wamid.1' });
  assert.equal(messages[0].status, 'sent'); assert.equal(messages[0].whatsappMessageId, 'wamid.1'); assert.ok(events.every((event) => String(event).includes('7')));
});

test('outbound persistence fails before insert when canonical identity is missing', async () => {
  let inserts = 0;
  const service = createOutboundHistoryService({
    Contact: { findByPk: async () => ({ id: 2, phone: '94770000123' }) },
    Message: { create: async () => { inserts += 1; } },
    canonicalConversationService: { resolveCanonicalWhatsAppConversation: async () => null },
    socketService: {}, logger: { warn() {} }
  });
  await assert.rejects(() => service.prepare({ phone: '94770000123', contactId: 2 })); assert.equal(inserts, 0);
});

test('receipt delivery uses receipt conversation and account for Meta and history', async () => {
  const receipt = row({ id: 1, status: 'ACTIVE', pdfStorageKey: 'a.pdf', studentId: 5, receiptNumber: 'R1', paidAmount: 1, remainingBalance: 0, conversationId: 7, whatsappAccountId: 3 });
  const conversation = row({ id: 7, contactId: 2, whatsappAccountId: 3, status: 'open' });
  let metaAccount; let historyConversation;
  const service = createPaymentReceiptDeliveryService({
    PaymentReceipt: { findByPk: async () => receipt }, Student: { findByPk: async () => ({ contactId: 2, phone: '94770000123' }) },
    Message: { findOne: async () => ({ id: 1 }) }, canonicalConversationService: { resolveCanonicalWhatsAppConversation: async (input) => { historyConversation = input.preferredConversationId; return conversation; } },
    outboundHistoryService: { prepare: async (payload) => ({ payload, conversation, message: row({ id: 1 }) }), complete: async () => {}, fail: async () => {} },
    receiptStorageService: { resolveKey: () => 'a.pdf' }, auditService: { record: async () => {} },
    whatsappService: { uploadMedia: async ({ whatsappAccountId }) => { metaAccount = whatsappAccountId; return { id: 'm' }; }, sendMediaMessage: async () => ({ id: 'w' }) }
  });
  await service.send(1); assert.equal(historyConversation, 7); assert.equal(metaAccount, 3); assert.equal(receipt.conversationId, 7);
});

test('24 hour service-window failure does not create a replacement conversation', async () => {
  let resolutions = 0;
  const conversation = { id: 7, contactId: 2, whatsappAccountId: 3 };
  const service = createPaymentReceiptDeliveryService({
    PaymentReceipt: { findByPk: async () => row({ id: 1, status: 'ACTIVE', pdfStorageKey: 'a', studentId: 5, conversationId: 7, whatsappAccountId: 3 }) },
    Student: { findByPk: async () => ({ contactId: 2, phone: '9477' }) }, Message: { findOne: async () => null },
    canonicalConversationService: { resolveCanonicalWhatsAppConversation: async () => { resolutions += 1; return conversation; } }
  });
  await assert.rejects(() => service.send(1), { code: 'RECEIPT_WHATSAPP_TEMPLATE_REQUIRED' }); assert.equal(resolutions, 1);
});

test('repair utility defaults to report-only and covers payment references', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/scripts/repair_duplicate_whatsapp_conversations.js'), 'utf8');
  assert.match(source, /apply = false/); assert.match(source, /payment_receipts/); assert.match(source, /payment_slips/); assert.match(source, /status = 'archived'/);
});

test('inbox list explicitly excludes archived duplicate conversations', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/chat.service.js'), 'utf8');
  assert.match(source, /status: \{ \[Op\.ne\]: 'archived' \}/);
});

test('canonical payment conversation migration is additive and idempotent', async () => {
  const migration = require('../migrations/039_canonical_payment_whatsapp_conversation');
  const schemas = new Map(); let adds = 0; let indexes = 0;
  const sequelize = {
    transaction: async (callback) => callback({ id: 'tx' }),
    query: async (sql) => {
      if (/SELECT contact_id/.test(sql)) return [[], {}];
      if (/CREATE UNIQUE INDEX/.test(sql)) indexes += 1;
      return [[], {}];
    }
  };
  const q = {
    sequelize,
    describeTable: async (table) => Object.fromEntries(schemas.get(table) || []),
    addColumn: async (table, column, definition) => {
      const entries = schemas.get(table) || []; entries.push([column, definition]); schemas.set(table, entries); adds += 1;
    }
  };
  const Sequelize = { DataTypes: { BIGINT: 'BIGINT' } };
  await migration.up(q, Sequelize); await migration.up(q, Sequelize);
  assert.equal(adds, 10); assert.equal(indexes, 2);
});

test('queue retry reuses pending history and the canonical Meta account', async () => {
  const queueModule = require('../src/services/messageQueue.service');
  const history = require('../src/services/outboundHistory.service');
  const service = new queueModule.MessageQueueService();
  const original = { prepare: history.prepare, complete: history.complete, fail: history.fail };
  const seenHistoryIds = []; const sentAccounts = [];
  const message = row({ id: 44, status: 'pending', rawPayload: {} });
  history.prepare = async (payload) => {
    seenHistoryIds.push(payload.historyMessageId);
    return { payload, message, contact: { id: 2 }, conversation: row({ id: 7, contactId: 2, whatsappAccountId: 3 }) };
  };
  history.complete = async (prepared, result) => prepared.message.update({ status: result.status, whatsappMessageId: result.whatsappMessageId });
  history.fail = async () => {};
  let attempt = 0;
  service.dispatch = async (queueRow, accountId) => {
    sentAccounts.push(accountId); attempt += 1;
    if (attempt === 1) throw new Error('temporary Meta error');
    return { messages: [{ id: 'wamid.retry' }] };
  };
  const queueRow = row({
    id: 10, channel: 'whatsapp', messageType: 'text', toNumber: '94770000123',
    whatsappAccountId: 3, conversationId: 7, contactId: 2,
    payload: { text: 'paid', paymentSlipId: 8, conversationId: 7, whatsappAccountId: 3, contactId: 2 },
    attempts: 0, maxAttempts: 3
  });
  try {
    await service.processOne(queueRow); await service.processOne(queueRow);
    assert.deepEqual(seenHistoryIds, [null, 44]); assert.deepEqual(sentAccounts, [3, 3]);
    assert.equal(queueRow.conversationId, 7); assert.equal(queueRow.externalMessageId, 'wamid.retry');
  } finally {
    Object.assign(history, original);
  }
});
