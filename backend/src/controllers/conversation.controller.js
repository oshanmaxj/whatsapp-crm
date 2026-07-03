const inboxService = require('../services/inbox.service');

class ConversationController {
  async list(req, res, next) {
    try {
      const data = await inboxService.listConversations(req.query, req.user.id);
      return res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async get(req, res, next) {
    try {
      const data = await inboxService.getConversation(req.params.id, req.user.id);
      return res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async update(req, res, next) {
    try {
      const data = await inboxService.updateConversation(req.params.id, req.body, req.user.id);
      return res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async assign(req, res, next) {
    try {
      const data = await inboxService.assignConversation(req.params.id, req.body, req.user.id);
      return res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async setLabels(req, res, next) {
    try {
      const data = await inboxService.setLabels(req.params.id, req.body.labels || [], req.user.id);
      return res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new ConversationController();
