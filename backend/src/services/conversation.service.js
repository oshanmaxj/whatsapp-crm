const { Conversation } = require('../models');

class ConversationService {
  async findByThreadId(threadId) {
    return Conversation.findOne({ where: { whatsappThreadId: threadId } });
  }

  async createConversation({ contactId, leadId, whatsappThreadId, assignedTo, lastMessageAt }) {
    return Conversation.create({
      contactId,
      leadId,
      whatsappThreadId,
      assignedUserId: assignedTo,
      lastMessageAt
    });
  }

  async updateSummary(conversationId, summary, suggestedAgent = null) {
    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) {
      const error = new Error('Conversation not found');
      error.status = 404;
      throw error;
    }
    return conversation.update({ summary, suggestedAgent });
  }

  async upsertConversation({ contactId, leadId, whatsappThreadId, assignedTo, lastMessageAt }) {
    let conversation = await this.findByThreadId(whatsappThreadId);
    if (!conversation && contactId) {
      conversation = await Conversation.findOne({
        where: { contactId },
        order: [['last_message_at', 'DESC'], ['updated_at', 'DESC']]
      });
    }
    if (conversation) {
      return conversation.update({
        contactId,
        leadId: leadId || conversation.leadId,
        whatsappThreadId,
        assignedUserId: assignedTo ?? conversation.assignedUserId,
        lastMessageAt
      });
    }

    return this.createConversation({ contactId, leadId, whatsappThreadId, assignedTo, lastMessageAt });
  }
}

module.exports = new ConversationService();
