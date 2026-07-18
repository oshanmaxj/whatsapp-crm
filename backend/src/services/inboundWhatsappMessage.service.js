const models = require('../models');

function requiredId(value, field) {
  if (value === null || value === undefined || value === '') {
    const error = new Error(`Inbound WhatsApp message requires ${field}`);
    error.code = `INBOUND_${field.replace(/Id$/, '').replace(/([A-Z])/g, '_$1').toUpperCase()}_REQUIRED`;
    throw error;
  }
  return value;
}

function readAttribute(record, attribute) {
  if (!record) return null;
  if (typeof record.get === 'function') return record.get(attribute);
  return record[attribute];
}

function createInboundWhatsappMessageService(dependencies = {}) {
  const Message = dependencies.Message || models.Message;

  return {
    async persist({
      contact,
      conversation,
      whatsappAccountId,
      whatsappMessageId,
      replyToWhatsappMessageId = null,
      values = {},
      transaction
    }) {
      if (!transaction) {
        const error = new Error('Inbound WhatsApp message persistence requires a transaction');
        error.code = 'INBOUND_TRANSACTION_REQUIRED';
        throw error;
      }

      const contactId = requiredId(contact?.id, 'contactId');
      const conversationId = requiredId(conversation?.id, 'conversationId');
      requiredId(whatsappAccountId, 'whatsappAccountId');
      requiredId(whatsappMessageId, 'whatsappMessageId');

      const existing = await Message.findOne({
        where: { whatsappMessageId },
        transaction
      });
      if (existing) {
        const existingConversationId = readAttribute(existing, 'conversationId');
        if (!existingConversationId) {
          const error = new Error('Existing inbound WhatsApp message has no conversation');
          error.code = 'INBOUND_ORPHAN_MESSAGE_FOUND';
          error.messageId = existing.id;
          throw error;
        }
        return { messageRecord: existing, replyToMessage: null, created: false };
      }

      const replyToMessage = replyToWhatsappMessageId
        ? await Message.findOne({
            where: { conversationId, whatsappMessageId: replyToWhatsappMessageId },
            attributes: ['id', 'whatsappMessageId', 'direction', 'type', 'text', 'mediaUrl', 'templateName', 'rawPayload'],
            transaction
          })
        : null;

      const messageRecord = await Message.create({
        ...values,
        whatsappMessageId,
        contactId,
        conversationId,
        whatsappAccountId,
        replyToMessageId: replyToMessage?.id || null,
        replyToWhatsappMessageId
      }, { transaction });

      if (!readAttribute(messageRecord, 'conversationId')) {
        const error = new Error('Inbound WhatsApp message was created without a conversation');
        error.code = 'INBOUND_MESSAGE_CONVERSATION_NOT_PERSISTED';
        throw error;
      }

      return { messageRecord, replyToMessage, created: true };
    }
  };
}

function buildInboundSocketPayload(messageRecord, values = {}) {
  const conversationId = requiredId(values.conversationId, 'conversationId');
  return {
    ...(messageRecord?.toJSON ? messageRecord.toJSON() : messageRecord || {}),
    ...values,
    conversationId,
    conversation_id: conversationId
  };
}

module.exports = createInboundWhatsappMessageService();
module.exports.createInboundWhatsappMessageService = createInboundWhatsappMessageService;
module.exports.buildInboundSocketPayload = buildInboundSocketPayload;
