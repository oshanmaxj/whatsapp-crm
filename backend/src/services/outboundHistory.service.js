const { Op } = require('sequelize');
const { Contact, Conversation, Message } = require('../models');
const logger = require('../config/logger');
const socketService = require('./socket.service');

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.startsWith('00') ? digits.slice(2) : digits;
}

function contactName(contact, fallback) {
  return [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || fallback || 'WhatsApp contact';
}

class OutboundHistoryService {
  async resolveContact({ contactId, phone, name }) {
    if (contactId) {
      const byId = await Contact.findByPk(contactId);
      if (byId) return byId;
    }

    const normalized = normalizePhone(phone);
    const candidates = await Contact.findAll({
      where: {
        [Op.or]: [
          { phone: normalized },
          { whatsappId: normalized },
          { phone: { [Op.like]: `%${normalized.slice(-7)}` } },
          { whatsappId: { [Op.like]: `%${normalized.slice(-7)}` } }
        ]
      },
      limit: 20
    });
    let contact = candidates.find((candidate) => (
      normalizePhone(candidate.phone) === normalized
      || normalizePhone(candidate.whatsappId) === normalized
    ));
    if (contact) return contact;

    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    [contact] = await Contact.findOrCreate({
      where: { phone: normalized },
      defaults: {
        phone: normalized,
        whatsappId: normalized,
        firstName: parts.shift() || 'WhatsApp',
        lastName: parts.join(' ') || null,
        status: 'active',
        whatsappAccountId: null
      }
    });
    return contact;
  }

  async resolveConversation({ conversationId, contact, leadId, whatsappAccountId = null }) {
    if (conversationId) {
      const byId = await Conversation.findByPk(conversationId);
      if (byId) return byId;
    }

    let conversation = await Conversation.findOne({
      where: { contactId: contact.id, whatsappAccountId },
      order: [['last_message_at', 'DESC'], ['updated_at', 'DESC']]
    });
    if (conversation) {
      if (!conversation.leadId && leadId) await conversation.update({ leadId });
      return conversation;
    }

    conversation = await Conversation.create({
      contactId: contact.id,
      leadId: leadId || null,
      whatsappThreadId: [whatsappAccountId || 'default', contact.whatsappId || normalizePhone(contact.phone)].join(':'),
      whatsappAccountId,
      status: 'open',
      lastMessageAt: new Date()
    });
    return conversation;
  }

  async record(payload) {
    try {
      const contact = await this.resolveContact(payload);
      const conversation = await this.resolveConversation({ ...payload, contact });
      const now = new Date();
      const values = {
        whatsappMessageId: payload.whatsappMessageId || null,
        conversationId: conversation.id,
        contactId: contact.id,
        sentByUserId: payload.sentByUserId || null,
        direction: 'outbound',
        channel: 'whatsapp',
        type: payload.type || 'text',
        messageType: payload.messageType || payload.type || 'text',
        text: payload.text || null,
        mediaId: payload.mediaId || null,
        mediaUrl: payload.mediaUrl || null,
        interactiveType: payload.interactiveType || null,
        buttonPayload: payload.buttonPayload || null,
        templateName: payload.templateName || null,
        campaignId: payload.campaignId || null,
        campaignRecipientId: payload.campaignRecipientId || null,
        isInternalNotification: Boolean(payload.isInternalNotification),
        sentToUserId: payload.sentToUserId || null,
        sentToPhone: payload.sentToPhone || null,
        fromNumber: payload.fromNumber || null,
        toNumber: normalizePhone(payload.isInternalNotification ? payload.sentToPhone : payload.phone),
        status: payload.status || 'sent',
        statusUpdatedAt: now,
        isRead: true,
        rawPayload: payload.rawPayload || {}
        , whatsappAccountId: payload.whatsappAccountId || conversation.whatsappAccountId || null
      };

      let message = values.whatsappMessageId
        ? await Message.findOne({ where: { whatsappMessageId: values.whatsappMessageId } })
        : null;
      if (message) await message.update(values);
      else message = await Message.create(values);

      const preview = payload.isInternalNotification
        ? `Assignment notification sent to ${payload.sentToUserName || contactName(null, 'agent')}`
        : payload.text || payload.templateName || 'WhatsApp message';
      await conversation.update({
        lastMessage: preview,
        lastMessageAt: now,
        updatedAt: now
      });

      const event = message.toJSON();
      socketService.emitToRoom(`conversation_${conversation.id}`, 'chat:message', event);
      await socketService.emitToConversationAudience(conversation.id, 'chat:message', event);
      return message;
    } catch (error) {
      logger.warn('outbound_chat_history_save_failed', {
        phone: normalizePhone(payload.phone),
        campaignId: payload.campaignId || null,
        campaignRecipientId: payload.campaignRecipientId || null,
        conversationId: payload.conversationId || null,
        message: error.message
      });
      return null;
    }
  }
}

module.exports = new OutboundHistoryService();
