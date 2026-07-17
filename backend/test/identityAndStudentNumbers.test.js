const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, requireNormalizedPhone } = require('../src/utils/phone');
const {
  createStudentRegistrationNumberService,
  formatStudentRegistrationNumber
} = require('../src/services/studentRegistrationNumber.service');
const { createConversationIdentityService } = require('../src/services/conversationIdentity.service');

function identityEnvironment() {
  const contacts = [];
  const conversations = [];
  let transactionTail = Promise.resolve();
  const row = (values) => ({
    ...values,
    async update(updates) { Object.assign(this, updates); return this; },
    async restore() { this.deletedAt = null; return this; }
  });
  const sequelize = {
    getDialect: () => 'postgres',
    literal: (value) => value,
    async query(sql, options) {
      if (!sql.includes('pg_advisory_xact_lock')) return [[]];
      if (options.transaction.release) return [[]];
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => { release = resolve; });
      await previous;
      options.transaction.release = release;
      return [[]];
    },
    async transaction(callback) {
      const transaction = { LOCK: { UPDATE: 'UPDATE' }, release: null };
      try { return await callback(transaction); } finally { transaction.release?.(); }
    }
  };
  const Contact = {
    async findAll() { return contacts; },
    async findByPk(id) { return contacts.find((item) => String(item.id) === String(id)) || null; },
    async create(values) { const contact = row({ id: contacts.length + 1, deletedAt: null, ...values }); contacts.push(contact); return contact; }
  };
  const Conversation = {
    async findOne({ where }) {
      if (where.whatsappThreadId) return conversations.find((item) => item.whatsappThreadId === where.whatsappThreadId) || null;
      return conversations.find((item) => item.normalizedPhone === where.normalizedPhone
        && String(item.whatsappAccountId || '') === String(where.whatsappAccountId || '')) || null;
    },
    async create(values) { const conversation = row({ id: conversations.length + 1, ...values }); conversations.push(conversation); return conversation; }
  };
  return {
    contacts,
    conversations,
    service: createConversationIdentityService({
      sequelize, Contact, Conversation,
      socketService: { emit() {} },
      logger: { info() {} }
    })
  };
}

test('Sri Lankan phone variants normalize to one canonical identity', () => {
  for (const value of ['0775652000', '+94775652000', '94775652000', '94 77 565 2000', '(+94) 77-565-2000']) {
    assert.equal(normalizePhone(value), '94775652000');
  }
});

test('international phone numbers are preserved and invalid values are rejected', () => {
  assert.equal(normalizePhone('+1 (415) 555-2671'), '14155552671');
  assert.equal(normalizePhone('123'), null);
  assert.throws(() => requireNormalizedPhone(''), (error) => error.code === 'INVALID_PHONE_NUMBER');
});

test('student registration formatting starts at STU-010852 and stays six digits', () => {
  assert.equal(formatStudentRegistrationNumber(10852), 'STU-010852');
  assert.equal(formatStudentRegistrationNumber(10853), 'STU-010853');
  assert.equal(formatStudentRegistrationNumber(999999), 'STU-999999');
  assert.throws(() => formatStudentRegistrationNumber(1000000), (error) => error.code === 'STUDENT_NUMBER_SEQUENCE_EXHAUSTED');
});

test('student registration allocation uses nextval inside the supplied transaction', async () => {
  const transaction = { id: 'student-create' };
  const calls = [];
  const service = createStudentRegistrationNumberService({
    sequelize: {
      async query(sql, options) {
        calls.push({ sql, options });
        return [[{ value: '10852' }]];
      }
    }
  });
  assert.equal(await service.next({ transaction }), 'STU-010852');
  assert.equal(calls[0].options.transaction, transaction);
  assert.match(calls[0].sql, /nextval\('student_registration_number_seq'\)/);
  await assert.rejects(service.next(), (error) => error.code === 'STUDENT_NUMBER_TRANSACTION_REQUIRED');
});

test('phone variants reuse one contact and conversation for the same WhatsApp account', async () => {
  const env = identityEnvironment();
  const first = await env.service.findOrCreateByPhoneAndAccount({ phone: '0775652000', whatsappAccountId: 7 });
  const second = await env.service.findOrCreateByPhoneAndAccount({ phone: '+94775652000', whatsappAccountId: 7 });
  assert.equal(first.conversation.id, second.conversation.id);
  assert.equal(env.contacts.length, 1);
  assert.equal(env.conversations.length, 1);
});

test('concurrent inbound identity resolution creates one conversation', async () => {
  const env = identityEnvironment();
  const results = await Promise.all(Array.from({ length: 5 }, () => (
    env.service.findOrCreateByPhoneAndAccount({ phone: '(+94) 77-565-2000', whatsappAccountId: 7 })
  )));
  assert.equal(new Set(results.map((result) => result.conversation.id)).size, 1);
  assert.equal(env.contacts.length, 1);
  assert.equal(env.conversations.length, 1);
});

test('the same phone on different WhatsApp accounts has separate conversations', async () => {
  const env = identityEnvironment();
  const accountA = await env.service.findOrCreateByPhoneAndAccount({ phone: '0775652000', whatsappAccountId: 7 });
  const accountB = await env.service.findOrCreateByPhoneAndAccount({ phone: '94775652000', whatsappAccountId: 8 });
  assert.notEqual(accountA.conversation.id, accountB.conversation.id);
  assert.equal(env.contacts.length, 1);
  assert.equal(env.conversations.length, 2);
});
