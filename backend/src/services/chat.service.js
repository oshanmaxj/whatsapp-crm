const { Contact, Conversation, Message, User } = require('../models');
const whatsappConfig = require('../config/whatsapp');
const whatsappService = require('./whatsapp.service');

class ChatService {
  async sendChatMessage({ conversationId, senderId, text }) {
    const conversation = await Conversation.findByPk(conversationId, {
      include: [{ model: Contact, as: 'contact', attributes: ['id', 'phone'] }]
    });
    if (!conversation) {
      const error = new Error('Conversation not found');
      error.status = 404;
      throw error;
    }

    const toNumber = conversation.contact?.phone;
    if (!toNumber) {
      const error = new Error('Conversation contact does not have a phone number');
      error.status = 400;
      throw error;
    }

    let whatsappResponse = null;
    let status = 'queued';
    const realSendEnabled = process.env.WHATSAPP_SEND_ENABLED === 'true';

    if (realSendEnabled) {
      whatsappResponse = await whatsappService.sendTextMessage({ to: toNumber, text, log: false });
      status = 'sent';
    }

    const message = await Message.create({
      conversationId,
      contactId: conversation.contactId,
      senderId,
      direction: 'outbound',
      type: 'text',
      whatsappMessageId: whatsappResponse?.id || null,
      text,
      fromNumber: whatsappConfig.phoneNumberId || null,
      toNumber,
      status,
      isRead: true,
      rawPayload: {
        simulated: !realSendEnabled,
        whatsapp: whatsappResponse
      }
    });

    await conversation.update({ lastMessageAt: new Date() });
    return message;
  }

  async markConversationRead(conversationId, userId) {
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
    const conversations = await Conversation.findAll({
      where: { assignedTo: userId },
      include: [{ model: Message, as: 'messages', required: false }]
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
    return Conversation.findAll({
      where: { assignedTo: userId },
      order: [['updated_at', 'DESC']]
    });
  }

  async getConversationMessages(conversationId) {
    return Message.findAll({
      where: { conversationId },
      order: [['created_at', 'ASC']]
    });
  }
}

module.exports = new ChatService();
