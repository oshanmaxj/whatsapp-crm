const { Lead, Conversation, Message, Contact, User } = require('../models');
const aiService = require('../services/ai.service');
const conversationAccessService = require('../services/conversationAccess.service');

class AIController {
  async getConversationSummary(req, res, next) {
    try {
      const { conversationId } = req.params;
      await conversationAccessService.assertConversationAccess(conversationId, req.user.id);
      const conversation = await Conversation.findByPk(conversationId, {
        include: [
          { model: Contact, as: 'contact' },
          { model: Lead, as: 'lead' }
        ]
      });
      if (!conversation) {
        const error = new Error('Conversation not found');
        error.status = 404;
        throw error;
      }

      const messages = await Message.findAll({ where: { conversationId }, order: [['created_at', 'ASC']] });
      const summary = conversation.summary || await aiService.summarizeConversation({ messages, contact: conversation.contact || {}, lead: conversation.lead || {} });

      return res.status(200).json({ success: true, data: { summary } });
    } catch (error) {
      next(error);
    }
  }

  async getLeadScore(req, res, next) {
    try {
      const { leadId } = req.params;
      const lead = await Lead.findByPk(leadId, {
        include: [{ model: Contact, as: 'contact' }]
      });
      if (!lead) {
        const error = new Error('Lead not found');
        error.status = 404;
        throw error;
      }

      return res.status(200).json({
        success: true,
        data: {
          aiScore: lead.aiScore,
          qualificationStatus: lead.qualificationStatus,
          qualificationNotes: lead.qualificationNotes,
          sentiment: lead.sentiment
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async getAgentSuggestion(req, res, next) {
    try {
      const { conversationId } = req.params;
      await conversationAccessService.assertConversationAccess(conversationId, req.user.id);
      const conversation = await Conversation.findByPk(conversationId, {
        include: [
          { model: Contact, as: 'contact' },
          { model: Lead, as: 'lead' }
        ]
      });
      if (!conversation) {
        const error = new Error('Conversation not found');
        error.status = 404;
        throw error;
      }

      const summary = conversation.summary || '';
      const agents = await User.findAll({ where: { status: 'active' }, order: [['id', 'ASC']] });
      const suggestion = await aiService.suggestAgent({ lead: conversation.lead || {}, contact: conversation.contact || {}, conversationSummary: summary, availableAgents: agents });

      return res.status(200).json({ success: true, data: suggestion });
    } catch (error) {
      next(error);
    }
  }

  async previewReply(req, res, next) {
    try {
      const { messageText, contactId, leadId } = req.body;
      const contact = contactId ? await Contact.findByPk(contactId) : null;
      const lead = leadId ? await Lead.findByPk(leadId) : null;
      const reply = await aiService.previewReply({ messageText, contact, lead });
      return res.status(200).json({ success: true, data: { reply } });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AIController();
