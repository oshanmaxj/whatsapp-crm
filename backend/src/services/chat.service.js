const { Contact, Conversation, Message, User } = require('../models');
const whatsappService = require('./whatsapp.service');
const whatsappComplianceService = require('./whatsappCompliance.service');
const whatsappTemplateService = require('./whatsappTemplate.service');
const conversationAccessService = require('./conversationAccess.service');

function normalizeWhatsAppNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.startsWith('00') ? digits.slice(2) : digits;
}

function previewText(message) {
  if (!message) return null;
  if (message.text) return message.text;
  if (message.templateName) return message.templateName;
  if (message.type === 'document') {
    return `Document: ${message.rawPayload?.file?.fileName || message.rawPayload?.document?.filename || message.rawPayload?.filename || 'Document'}`;
  }
  if (['image', 'video', 'audio'].includes(message.type)) {
    return message.type.charAt(0).toUpperCase() + message.type.slice(1);
  }
  return message.type || 'Message';
}

function senderLabel(message) {
  if (!message) return 'Previous message';
  return message.direction === 'outbound' ? 'You' : 'Customer';
}

function serializeSentBy(user) {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Agent';
  return { id: user.id, name, email: user.email || null };
}

function serializeMessage(message) {
  const json = message?.toJSON ? message.toJSON() : message;
  if (!json) return json;
  const reply = json.replyToMessage || null;
  const replyPreview = reply
    ? {
        id: reply.id,
        whatsappMessageId: reply.whatsappMessageId,
        sender: senderLabel(reply),
        direction: reply.direction,
        type: reply.type,
        text: previewText(reply)
      }
    : json.replyToWhatsappMessageId
      ? {
          id: null,
          whatsappMessageId: json.replyToWhatsappMessageId,
          sender: 'Previous message',
          type: 'unknown',
          text: 'Replied to a previous message'
        }
      : null;
  return { ...json, sentBy: serializeSentBy(json.sentBy), replyPreview };
}

class ChatService {
  async resolveReplyContext(conversationId, replyToMessageId) {
    if (!replyToMessageId) return { replyToMessageId: null, replyToWhatsappMessageId: null };
    const original = await Message.findOne({
      where: { id: replyToMessageId, conversationId },
      attributes: ['id', 'whatsappMessageId']
    });
    if (!original) {
      const error = new Error('Reply target message not found');
      error.status = 404;
      throw error;
    }
    if (!original.whatsappMessageId) {
      const error = new Error('Reply target does not have a WhatsApp message id yet');
      error.status = 409;
      throw error;
    }
    return {
      replyToMessageId: original.id,
      replyToWhatsappMessageId: original.whatsappMessageId
    };
  }

  async sendChatMessage({ conversationId, senderId, text, replyToMessageId = null }) {
    await conversationAccessService.assertConversationAccess(conversationId, senderId);
    const conversation = await Conversation.findByPk(conversationId, {
      include: [{ model: Contact, as: 'contact', attributes: ['id', 'phone', 'whatsappId'] }]
    });
    if (!conversation) {
      const error = new Error('Conversation not found');
      error.status = 404;
      throw error;
    }

    const toNumber = normalizeWhatsAppNumber(
      conversation.contact?.whatsappId || conversation.contact?.phone
    );
    if (!toNumber) {
      const error = new Error('Conversation contact does not have a phone number');
      error.status = 400;
      throw error;
    }

    const compliance = await whatsappComplianceService.canSendFreeFormMessage(conversation.contactId);
    if (!compliance.canSend) {
      const error = new Error('Template required to message this customer.');
      error.status = 409;
      error.code = 'TEMPLATE_REQUIRED';
      error.lastInboundAt = compliance.lastInboundAt;
      throw error;
    }

    const runtimeConfig = await whatsappService.getRuntimeConfig();
    const replyContext = await this.resolveReplyContext(conversationId, replyToMessageId);
    const message = await Message.create({
      conversationId,
      contactId: conversation.contactId,
      sentByUserId: senderId,
      direction: 'outbound',
      type: 'text',
      whatsappMessageId: null,
      text,
      fromNumber: runtimeConfig.phoneNumberId || null,
      toNumber,
      status: 'pending',
      replyToMessageId: replyContext.replyToMessageId,
      replyToWhatsappMessageId: replyContext.replyToWhatsappMessageId,
      statusUpdatedAt: new Date(),
      isRead: true,
      rawPayload: {}
    });

    try {
      const whatsappResponse = await whatsappService.sendTextMessage({
        to: toNumber,
        text,
        contextMessageId: replyContext.replyToWhatsappMessageId,
        log: false
      });
      await message.update({
        whatsappMessageId: whatsappResponse?.id || null,
        status: 'sent',
        statusUpdatedAt: new Date(),
        rawPayload: { whatsapp: whatsappResponse }
      });
      await conversation.update({ lastMessageAt: new Date() });
      return this.getMessageWithReplyPreview(message.id);
    } catch (error) {
      const metaError = error.metaError || error.response?.data || {};
      const whatsappError = metaError.error || metaError;
      await message.update({
        status: 'failed',
        statusUpdatedAt: new Date(),
        errorCode: whatsappError?.code == null ? null : String(whatsappError.code),
        errorMessage: whatsappError?.error_user_msg || whatsappError?.message || error.message,
        rawPayload: { whatsappError: metaError }
      }).catch(() => {});
      error.messageRecord = await this.getMessageWithReplyPreview(message.id);
      throw error;
    }
  }

  async sendChatTemplate({
    conversationId,
    senderId,
    templateName,
    languageCode,
    components = [],
    replyToMessageId = null
  }) {
    await conversationAccessService.assertConversationAccess(conversationId, senderId);
    const conversation = await Conversation.findByPk(conversationId, {
      include: [{ model: Contact, as: 'contact', attributes: ['id', 'phone', 'whatsappId'] }]
    });
    if (!conversation) throw Object.assign(new Error('Conversation not found'), { status: 404 });

    const toNumber = normalizeWhatsAppNumber(
      conversation.contact?.whatsappId || conversation.contact?.phone
    );
    if (!toNumber) {
      throw Object.assign(new Error('Conversation contact does not have a phone number'), { status: 400 });
    }

    const template = await whatsappTemplateService.approvedTemplateByName(
      templateName,
      languageCode
    );
    if (!template) {
      const error = new Error('Approved WhatsApp template not found');
      error.status = 400;
      error.code = 'TEMPLATE_NOT_APPROVED';
      throw error;
    }

    const runtimeConfig = await whatsappService.getRuntimeConfig();
    const replyContext = await this.resolveReplyContext(conversationId, replyToMessageId);
    const message = await Message.create({
      conversationId,
      contactId: conversation.contactId,
      sentByUserId: senderId,
      direction: 'outbound',
      type: 'template',
      templateName: template.name,
      text: template.body,
      fromNumber: runtimeConfig.phoneNumberId || null,
      toNumber,
      status: 'pending',
      replyToMessageId: replyContext.replyToMessageId,
      replyToWhatsappMessageId: replyContext.replyToWhatsappMessageId,
      statusUpdatedAt: new Date(),
      isRead: true,
      rawPayload: { template: { name: template.name, language: template.language, components } }
    });

    try {
      const whatsappResponse = await whatsappService.sendTemplateMessage({
        to: toNumber,
        templateName: template.name,
        language: template.language,
        components,
        contextMessageId: replyContext.replyToWhatsappMessageId,
        log: false
      });
      await message.update({
        whatsappMessageId: whatsappResponse?.id || null,
        status: 'sent',
        statusUpdatedAt: new Date(),
        rawPayload: {
          template: { name: template.name, language: template.language, components },
          whatsapp: whatsappResponse
        }
      });
      await conversation.update({ lastMessageAt: new Date() });
      return this.getMessageWithReplyPreview(message.id);
    } catch (error) {
      const metaError = error.metaError || error.response?.data || {};
      const whatsappError = metaError.error || metaError;
      await message.update({
        status: 'failed',
        statusUpdatedAt: new Date(),
        errorCode: whatsappError?.code == null ? null : String(whatsappError.code),
        errorMessage: whatsappError?.error_user_msg || whatsappError?.message || error.message,
        rawPayload: { whatsappError: metaError }
      }).catch(() => {});
      error.messageRecord = await this.getMessageWithReplyPreview(message.id);
      throw error;
    }
  }

  async getMessageStatus(id, userId) {
    const message = await Message.findByPk(id, {
      attributes: ['id', 'conversationId', 'whatsappMessageId', 'status', 'statusUpdatedAt']
    });
    if (!message) {
      const error = new Error('Message not found');
      error.status = 404;
      throw error;
    }
    await conversationAccessService.assertConversationAccess(message.conversationId, userId);
    return message;
  }

  async getMessageWithReplyPreview(id) {
    const message = await Message.findByPk(id, {
      include: [
        {
          model: Message,
          as: 'replyToMessage',
          attributes: ['id', 'whatsappMessageId', 'direction', 'type', 'text', 'mediaUrl', 'templateName', 'rawPayload'],
          required: false
        },
        {
          model: User,
          as: 'sentBy',
          attributes: ['id', 'firstName', 'lastName', 'email'],
          required: false
        }
      ]
    });
    return serializeMessage(message);
  }

  async markConversationRead(conversationId, userId) {
    await conversationAccessService.assertConversationAccess(conversationId, userId);
    return Message.update(
      { isRead: true, readAt: new Date() },
      {
        where: {
          conversationId,
          direction: 'inbound',
          isRead: false
        }
      }
    );
  }

  async getConversationUnreadCount(conversationId, userId) {
    await conversationAccessService.assertConversationAccess(conversationId, userId);
    const unread = await Message.count({
      where: {
        conversationId,
        direction: 'inbound',
        isRead: false
      }
    });

    return unread;
  }

  async getUnreadCountsForUser(userId) {
    const where = await conversationAccessService.whereForUser(userId);
    const conversations = await Conversation.findAll({
      where,
      attributes: ['id']
    });

    let totalUnread = 0;
    for (const conversation of conversations) {
      const unread = await Message.count({
        where: {
          conversationId: conversation.id,
          direction: 'inbound',
          isRead: false
        }
      });
      totalUnread += unread;
    }

    return totalUnread;
  }

  async getConversationList(userId) {
    const where = await conversationAccessService.whereForUser(userId);
    return Conversation.findAll({
      where,
      order: [['updated_at', 'DESC']]
    });
  }

  async getConversationMessages(conversationId, userId) {
    await conversationAccessService.assertConversationAccess(conversationId, userId);
    const messages = await Message.findAll({
      where: { conversationId },
      include: [
        {
          model: Message,
          as: 'replyToMessage',
          attributes: ['id', 'whatsappMessageId', 'direction', 'type', 'text', 'mediaUrl', 'templateName', 'rawPayload'],
          required: false
        },
        {
          model: User,
          as: 'sentBy',
          attributes: ['id', 'firstName', 'lastName', 'email'],
          required: false
        }
      ],
      order: [['created_at', 'ASC']]
    });
    return messages.map(serializeMessage);
  }
}

module.exports = new ChatService();
