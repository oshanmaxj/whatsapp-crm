const service = require('../services/notificationTemplate.service');

const ok = (res, data) => res.status(200).json({ success: true, data });

class NotificationTemplateController {
  async list(req, res, next) { try { return ok(res, await service.list()); } catch (error) { next(error); } }
  async get(req, res, next) { try { return ok(res, await service.getByKey(req.params.key)); } catch (error) { next(error); } }
  async update(req, res, next) { try { return ok(res, await service.update(req.params.id, req.body)); } catch (error) { next(error); } }
  async preview(req, res, next) { try { return ok(res, await service.preview(req.params.key, req.body?.variables || req.body || {})); } catch (error) { next(error); } }
}

module.exports = new NotificationTemplateController();
