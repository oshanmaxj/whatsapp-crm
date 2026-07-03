const inboxService = require('../services/inbox.service');

class NoteController {
  async list(req, res, next) {
    try {
      const data = await inboxService.listNotes(req.query.conversationId, req.user.id);
      return res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const data = await inboxService.createNote({ ...req.body, createdBy: req.user?.id || null }, req.user.id);
      return res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new NoteController();
