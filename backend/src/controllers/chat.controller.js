const chatService = require('../services/chat.service');

class ChatController {
  async getConversations(req, res, next) {
    try {
      const userId = req.user.id;
      const conversations = await chatService.getConversationList(userId);
      return res.status(200).json({ success: true, data: conversations });
    } catch (err) {
      next(err);
    }
  }

  async getMessages(req, res, next) {
    try {
      const { conversationId } = req.params;
      const messages = await chatService.getConversationMessages(conversationId);
      return res.status(200).json({ success: true, data: messages });
    } catch (err) {
      next(err);
    }
  }

  async getUnread(req, res, next) {
    try {
      const userId = req.user.id;
      const unread = await chatService.getUnreadCountsForUser(userId);
      return res.status(200).json({ success: true, data: { unread } });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ChatController();