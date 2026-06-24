const inboxService = require('../services/inbox.service');

class TemplateController {
  async list(req, res, next) {
    try {
      const data = await inboxService.listTemplates(req.query);
      return res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const data = await inboxService.createTemplate({ ...req.body, createdBy: req.user?.id || null });
      return res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new TemplateController();
