const labelService = require('../services/label.service');

class LabelController {
  async list(req, res, next) {
    try {
      const data = await labelService.list(req.query);
      return res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async create(req, res, next) {
    try {
      const data = await labelService.create(req.body, req.user);
      return res.status(201).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new LabelController();
