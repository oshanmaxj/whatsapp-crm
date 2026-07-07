const autoReplyService = require('../services/autoReply.service');

class AutoReplyController {
  async list(req, res, next) {
    try {
      const replies = await autoReplyService.listReplies(req.query.whatsappAccountId);
      return res.status(200).json({ success: true, data: replies });
    } catch (err) {
      next(err);
    }
  }

  async get(req, res, next) {
    try {
      const reply = await autoReplyService.getReplyById(req.params.id);
      if (!reply) {
        const error = new Error('Auto reply not found');
        error.status = 404;
        throw error;
      }
      return res.status(200).json({ success: true, data: reply });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const reply = await autoReplyService.createReply(req.body);
      return res.status(201).json({ success: true, data: reply });
    } catch (err) {
      next(err);
    }
  }

  async update(req, res, next) {
    try {
      const reply = await autoReplyService.updateReply(req.params.id, req.body);
      return res.status(200).json({ success: true, data: reply });
    } catch (err) {
      next(err);
    }
  }

  async remove(req, res, next) {
    try {
      const result = await autoReplyService.deleteReply(req.params.id);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AutoReplyController();
