const test = require('node:test');
const assert = require('node:assert/strict');
const models = require('../src/models');
const { createConversationIdentityService } = require('../src/services/conversationIdentity.service');
const {
  createInboundWhatsappMessageService,
  buildInboundSocketPayload
} = require('../src/services/inboundWhatsappMessage.service');

function row(values) {
  return {
    ...values,
    async update(updates) { Object.assign(this, updates); return this; },
    get(attribute) { return this[attribute]; },
    toJSON() { return { ...this }; }
  };
}

test('Message associations do not inject duplicate physical conversation/account attributes', () => {
  assert.equal(models.Message.rawAttributes.conversationId.field, 'conversation_id');
  assert.equal(models.Message.rawAttributes.whatsappAccountId.field, 'whatsapp_account_id');
  assert.equal(models.Message.rawAttributes.replyToMessageId.field, 'reply_to_message_id');
  assert.equal(models.Message.rawAttributes.conversation_id, undefined);
  assert.equal(models.Message.rawAttributes.whatsapp_account_id, undefined);
  assert.equal(models.Message.rawAttributes.reply_to_message_id, undefined);
});

test('inbound persistence requires a conversation before querying or creating a message', async () => {
  let queried = false;
  let created = false;
  const service = createInboundWhatsappMessageService({
    Message: {
      async findOne() { queried = true; return null; },
      async create() { created = true; return null; }
    }
  });
  await assert.rejects(() => service.persist({
    contact: { id: 1 }, conversation: null, whatsappAccountId: 7,
    whatsappMessageId: 'wamid.missing-conversation', transaction: { id: 1 }
  }), { code: 'INBOUND_CONVERSATION_REQUIRED' });
  assert.equal(queried, false);
  assert.equal(created, false);
});

test('identity transaction creates one conversation and persists one non-orphan message across a webhook retry', async () => {
  const transaction = { id: 'inbound-tx', LOCK: { UPDATE: 'UPDATE' } };
  const contact = row({ id: 11, whatsappId: '94771234567' });
  let conversation = null;
  let conversationCreates = 0;
  const messages = [];
  let messageCreates = 0;

  const Message = {
    async findOne({ where }) {
      return messages.find((item) => item.whatsappMessageId === where.whatsappMessageId) || null;
    },
    async create(values, options) {
      assert.equal(options.transaction, transaction);
      messageCreates += 1;
      const message = row({ id: 90, ...values });
      messages.push(message);
      return message;
    }
  };
  const messageService = createInboundWhatsappMessageService({ Message });
  const identityService = createConversationIdentityService({
    sequelize: {
      getDialect: () => 'postgres', literal: (value) => value,
      transaction: async (callback) => callback(transaction)
    },
    Contact: { findAll: async () => [], findByPk: async () => contact, create: async () => contact },
    Conversation: {
      async findOne() { return conversation; },
      async create(values, options) {
        assert.equal(options.transaction, transaction);
        conversationCreates += 1;
        conversation = row({ id: 44, ...values });
        return conversation;
      }
    },
    inboundWhatsappContactService: {
      resolveInboundWhatsAppContact: async () => ({ contact, strategy: 'whatsapp_id', conflict: false }),
      recordConflict: async () => null
    },
    socketService: { emit() {} }, logger: { info() {}, warn() {}, error() {} }
  });

  const persist = ({ contact: resolvedContact, conversation: resolvedConversation, transaction: tx }) => (
    messageService.persist({
      contact: resolvedContact,
      conversation: resolvedConversation,
      whatsappAccountId: 7,
      whatsappMessageId: 'wamid.retry',
      transaction: tx,
      values: { direction: 'inbound', channel: 'whatsapp', type: 'text', text: 'redacted' }
    })
  );
  const resolve = () => identityService.findOrCreateByPhoneAndAccount({
    phone: '94771234567', whatsappId: '94771234567', whatsappAccountId: 7,
    whatsappThreadId: 'phone-number-id:94771234567', afterResolve: persist
  });

  const first = await resolve();
  conversation.assignedUserId = 22;
  const retry = await resolve();
  assert.equal(conversationCreates, 1);
  assert.equal(messageCreates, 1);
  assert.equal(first.conversation.id, 44);
  assert.equal(retry.conversation.id, 44);
  assert.equal(conversation.assignedUserId, 22);
  assert.equal(first.persisted.messageRecord.contactId, 11);
  assert.equal(first.persisted.messageRecord.conversationId, 44);
  assert.equal(first.persisted.messageRecord.whatsappAccountId, 7);
  assert.equal(first.persisted.messageRecord.whatsappMessageId, 'wamid.retry');
  assert.equal(retry.persisted.created, false);
  assert.equal(messages.some((item) => item.conversationId == null), false);
});

test('an existing orphan retry is rejected instead of being silently reused', async () => {
  let creates = 0;
  const service = createInboundWhatsappMessageService({
    Message: {
      async findOne() { return row({ id: 8, whatsappMessageId: 'wamid.orphan', conversationId: null }); },
      async create() { creates += 1; }
    }
  });
  await assert.rejects(() => service.persist({
    contact: { id: 1 }, conversation: { id: 2 }, whatsappAccountId: 7,
    whatsappMessageId: 'wamid.orphan', transaction: { id: 1 }
  }), { code: 'INBOUND_ORPHAN_MESSAGE_FOUND' });
  assert.equal(creates, 0);
});

test('WebSocket payload exposes the canonical conversation ID in both API naming conventions', () => {
  const payload = buildInboundSocketPayload(row({ id: 90, conversationId: 44 }), {
    conversationId: 44, contactId: 11, direction: 'inbound'
  });
  assert.equal(payload.conversationId, 44);
  assert.equal(payload.conversation_id, 44);
});
