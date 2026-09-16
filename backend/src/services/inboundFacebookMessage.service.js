const models = require('../models');
const { normalizeMessagePresentation } = require('./messagePresentation.service');

function requiredId(value, field) {
  if (value === null || value === undefined || value === '') {
    const error = new Error(`Inbound Facebook message requires ${field}`);
    error.code = `INBOUND_FACEBOOK_${field.replace(/Id$/, '').replace(/([A-Z])/g, '_$1').toUpperCase()}_REQUIRED`;
    throw error;
  }
  return value;
}

function readAttribute(record, attribute) {
  if (!record) return null;
  if (typeof record.get === 'function') return record.get(attribute);
  return record[attribute];
}

function createInboundFacebookMessageService(dependencies = {}) {
  const Message = dependencies.Message || models.Message;

  return {
    async persist({
      contact,
      conversation,
      facebookPageId,
      facebookMessageId,
      values = {},
      transaction
    }) {
      if (!transaction) {
        const error = new Error('Inbound Facebook message persistence requires a transaction');
        error.code = 'INBOUND_FACEBOOK_TRANSACTION_REQUIRED';
        throw error;
      }

      const contactId = requiredId(contact?.id, 'contactId');
      const conversationId = requiredId(conversation?.id, 'conversationId');
      requiredId(facebookPageId, 'facebookPageId');
      requiredId(facebookMessageId, 'facebookMessageId');

      const existing = await Message.findOne({ where: { facebookMessageId }, transaction });
      if (existing) {
        return { messageRecord: existing, created: false };
      }

      const messageRecord = await Message.create({
        ...values,
        channel: 'facebook_messenger',
        facebookMessageId,
        contactId,
        conversationId,
        facebookPageId
      }, { transaction });

      if (!readAttribute(messageRecord, 'conversationId')) {
        const error = new Error('Inbound Facebook message was created without a conversation');
        error.code = 'INBOUND_FACEBOOK_MESSAGE_CONVERSATION_NOT_PERSISTED';
        throw error;
      }

      return { messageRecord, created: true };
    }
  };
}

function buildInboundSocketPayload(messageRecord, values = {}) {
  const conversationId = requiredId(values.conversationId, 'conversationId');
  return normalizeMessagePresentation({
    ...(messageRecord?.toJSON ? messageRecord.toJSON() : messageRecord || {}),
    ...values,
    conversationId,
    conversation_id: conversationId
  });
}

module.exports = createInboundFacebookMessageService();
module.exports.createInboundFacebookMessageService = createInboundFacebookMessageService;
module.exports.buildInboundSocketPayload = buildInboundSocketPayload;
