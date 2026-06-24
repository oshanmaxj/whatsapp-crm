const { Conversation, Message, User } = require('../models');

class ChatService {
  async sendChatMessage({ conversationId, senderId, text }) {
    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      const error = new Error('Conversation not found');
      error.status = 404;
      throw error;
    }

    const message = await Message.create({
      conversationId,
      senderId,
      direction: 'outbound',
      type: 'text',
      text,
      fromNumber: null,
      toNumber: null,
      status: 'sent',
      isRead: true,
      rawPayload: null
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
