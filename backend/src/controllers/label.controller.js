const inboxService = require('../services/inbox.service');

class LabelController {
  async list(req, res, next) {
    try {
      const data = await inboxService.listLabels();
      return res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const data = await inboxService.createLabel(req.body);
      return res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new LabelController();
