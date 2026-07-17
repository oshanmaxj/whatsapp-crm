const { Contact, Conversation } = require('../models');
const conversationIdentityService = require('./conversationIdentity.service');

class ConversationService {
  async findByThreadId(threadId) {
    return Conversation.findOne({ where: { whatsappThreadId: threadId } });
  }

  async createConversation({ contactId, leadId, whatsappThreadId, assignedTo, lastMessageAt, whatsappAccountId = null }) {
    const contact = await Contact.findByPk(contactId);
    if (!contact) throw Object.assign(new Error('Conversation contact not found.'), { status: 404 });
    const result = await conversationIdentityService.findOrCreateByPhoneAndAccount({
      contactId, phone: contact.phone, whatsappId: contact.whatsappId, leadId,
      whatsappThreadId, assignedTo, lastMessageAt, whatsappAccountId
    });
    return result.conversation;
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

  async upsertConversation({ contactId, leadId, whatsappThreadId, assignedTo, lastMessageAt, whatsappAccountId = null }) {
    const contact = await Contact.findByPk(contactId);
    if (!contact) throw Object.assign(new Error('Conversation contact not found.'), { status: 404 });
    const result = await conversationIdentityService.findOrCreateByPhoneAndAccount({
      contactId, phone: contact.phone, whatsappId: contact.whatsappId, leadId,
      whatsappThreadId, assignedTo, lastMessageAt, whatsappAccountId
    });
    return result.conversation;
  }
}

module.exports = new ConversationService();
