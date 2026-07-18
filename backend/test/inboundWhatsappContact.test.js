const test = require('node:test');
const assert = require('node:assert/strict');
const { createInboundWhatsappContactService } = require('../src/services/inboundWhatsappContact.service');
const { createConversationIdentityService } = require('../src/services/conversationIdentity.service');

function row(values) {
  return {
    ...values,
    updates: [],
    async update(updates) { this.updates.push(updates); Object.assign(this, updates); return this; },
    async restore() { this.deletedAt = null; return this; }
  };
}

function resolverEnvironment({ whatsappOwner = null, phoneContact = null, conversation = null } = {}) {
  const notifications = [];
  const logs = [];
  let findCount = 0;
  const Contact = {
    async findOne() { findCount += 1; return findCount % 2 === 1 ? whatsappOwner : phoneContact; },
    async findByPk(id) { return [whatsappOwner, phoneContact].find((item) => item?.id === id) || null; },
    async create(values) { return row({ id: 100, ...values }); }
  };
  const service = createInboundWhatsappContactService({
    sequelize: { getDialect: () => 'postgres', query: async () => [[]] },
    Contact,
    Conversation: { findOne: async () => conversation },
    Notification: { create: async (payload) => { notifications.push(payload); return payload; } },
    logger: { info: (event, data) => logs.push({ event, data }), warn: (event, data) => logs.push({ event, data }) }
  });
  return { service, notifications, logs };
}

test('WhatsApp ID owner wins when normalized phone resolves to another contact', async () => {
  const owner = row({ id: 1, phone: '94770000001', normalizedPhone: '94770000001', whatsappId: '94771234567', firstName: 'Canonical' });
  const phoneContact = row({ id: 3, phone: '94771234567', normalizedPhone: '94771234567', whatsappId: null, firstName: 'Duplicate' });
  const env = resolverEnvironment({ whatsappOwner: owner, phoneContact });
  const resolution = await env.service.resolveInboundWhatsAppContact({
    whatsappAccountId: 7,
    whatsappId: '94771234567',
    normalizedPhone: '94771234567',
    profileName: 'Customer Name',
    transaction: { LOCK: { UPDATE: 'UPDATE' } }
  });
  assert.equal(resolution.contact.id, 1);
  assert.equal(resolution.strategy, 'whatsapp_id');
  assert.equal(resolution.conflict, true);
  assert.equal(phoneContact.whatsappId, null);
  assert.equal(phoneContact.updates.length, 0);
  assert.equal(resolution.whatsappIdLastFour, '4567');
});

test('duplicate contact conflict creates a safe admin warning after resolution', async () => {
  const owner = row({ id: 1, whatsappId: '94771234567', firstName: 'Canonical' });
  const duplicate = row({ id: 3, phone: '94771234567', normalizedPhone: '94771234567' });
  const env = resolverEnvironment({ whatsappOwner: owner, phoneContact: duplicate });
  const resolution = await env.service.resolveInboundWhatsAppContact({
    whatsappAccountId: 7, whatsappId: '94771234567', normalizedPhone: '94771234567',
    transaction: { LOCK: { UPDATE: 'UPDATE' } }
  });
  await env.service.recordConflict(resolution, 7);
  assert.equal(env.notifications.length, 1);
  assert.equal(env.notifications[0].data.canonicalContactId, 1);
  assert.equal(env.notifications[0].data.phoneContactId, 3);
  assert.equal(JSON.stringify(env.notifications[0]).includes('94771234567'), false);
});

test('one WhatsApp ID remains one contact under concurrent inbound resolution', async () => {
  const contacts = [];
  let tail = Promise.resolve();
  const sequelize = {
    getDialect: () => 'postgres',
    async query(sql, options) {
      if (options.transaction.locked) return [[]];
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      options.transaction.locked = true;
      options.transaction.release = release;
      return [[]];
    },
    async transaction(callback) {
      const transaction = { LOCK: { UPDATE: 'UPDATE' }, locked: false };
      try { return await callback(transaction); } finally { transaction.release?.(); }
    }
  };
  const Contact = {
    async findOne({ where }) {
      if (where.whatsappId) return contacts.find((item) => item.whatsappId === where.whatsappId) || null;
      return contacts.find((item) => item.normalizedPhone === '94771234567') || null;
    },
    async findByPk() { return null; },
    async create(values) { const contact = row({ id: contacts.length + 1, ...values }); contacts.push(contact); return contact; }
  };
  const service = createInboundWhatsappContactService({
    sequelize, Contact, Conversation: { findOne: async () => null },
    Notification: { create: async () => null }, logger: { info() {}, warn() {} }
  });
  const resolve = () => sequelize.transaction((transaction) => service.resolveInboundWhatsAppContact({
    whatsappAccountId: 7, whatsappId: '94771234567', normalizedPhone: '94771234567', transaction
  }));
  const results = await Promise.all([resolve(), resolve(), resolve(), resolve()]);
  assert.equal(contacts.length, 1);
  assert.equal(new Set(results.map((item) => item.contact.id)).size, 1);
});

test('unique violation retries with a new transaction and never reuses the aborted one', async () => {
  const transactions = [];
  let createAttempts = 0;
  const contact = row({ id: 1, phone: '94771234567', normalizedPhone: '94771234567', whatsappId: '94771234567' });
  const sequelize = {
    getDialect: () => 'postgres', literal: (value) => value,
    async transaction(callback) { const transaction = { id: transactions.length + 1, LOCK: { UPDATE: 'UPDATE' } }; transactions.push(transaction); return callback(transaction); }
  };
  const Conversation = {
    async findOne() { return null; },
    async create(values, { transaction }) {
      createAttempts += 1;
      if (createAttempts === 1) {
        transaction.aborted = true;
        throw Object.assign(new Error('duplicate'), { original: { code: '23505', constraint: 'conversations_account_normalized_phone_unique' } });
      }
      assert.equal(transaction.aborted, undefined);
      return row({ id: 20, assignedUserId: 9, ...values });
    }
  };
  const service = createConversationIdentityService({
    sequelize, Contact: { findAll: async () => [], findByPk: async () => contact, create: async () => contact }, Conversation,
    inboundWhatsappContactService: {
      resolveInboundWhatsAppContact: async () => ({ contact, strategy: 'whatsapp_id', conflict: false }),
      recordConflict: async () => null
    }, socketService: { emit() {} }, logger: { info() {}, warn() {} }
  });
  const result = await service.findOrCreateByPhoneAndAccount({
    phone: '94771234567', whatsappId: '94771234567', whatsappAccountId: 7
  });
  assert.equal(result.conversation.id, 20);
  assert.equal(transactions.length, 2);
  assert.notEqual(transactions[0], transactions[1]);
});

test('contact, conversation and inbound message persist in one transaction without changing ownership', async () => {
  const transaction = { id: 'inbound-transaction', LOCK: { UPDATE: 'UPDATE' } };
  const contact = row({ id: 1, phone: '94771234567', normalizedPhone: '94771234567', whatsappId: '94771234567' });
  const conversation = row({ id: 9, contactId: 3, normalizedPhone: '94771234567', whatsappAccountId: 7, assignedUserId: 55, status: 'open' });
  let persistedWith;
  const service = createConversationIdentityService({
    sequelize: { getDialect: () => 'postgres', literal: (value) => value, transaction: async (callback) => callback(transaction) },
    Contact: { findAll: async () => [], findByPk: async () => contact, create: async () => contact },
    Conversation: { findOne: async () => conversation, create: async () => conversation },
    inboundWhatsappContactService: {
      resolveInboundWhatsAppContact: async () => ({ contact, strategy: 'whatsapp_id', conflict: true }),
      recordConflict: async () => null
    }, socketService: { emit() {} }, logger: { info() {}, warn() {} }
  });
  const result = await service.findOrCreateByPhoneAndAccount({
    phone: '94771234567', whatsappId: '94771234567', whatsappAccountId: 7,
    afterResolve: async ({ contact: resolved, conversation: thread, transaction: tx }) => {
      persistedWith = { resolved, thread, tx };
      return { messageRecord: { id: 77 }, created: true };
    }
  });
  assert.equal(result.persisted.messageRecord.id, 77);
  assert.equal(persistedWith.tx, transaction);
  assert.equal(conversation.contactId, 1);
  assert.equal(conversation.assignedUserId, 55);
});

test('webhook controller returns 200 after inbound processing completes', async () => {
  const controller = require('../src/controllers/webhook.controller');
  const whatsappService = require('../src/services/whatsapp.service');
  const original = whatsappService.processWebhook;
  let persisted = false;
  whatsappService.processWebhook = async () => { persisted = true; return { received: true }; };
  const response = {
    statusCode: null, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await controller.processWebhook({ body: { entry: [] }, headers: {}, rawBody: Buffer.from('{}') }, response, () => {});
  assert.equal(persisted, true);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.success, true);
  whatsappService.processWebhook = original;
});
