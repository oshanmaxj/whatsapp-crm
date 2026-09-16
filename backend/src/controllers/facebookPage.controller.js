const service = require('../services/facebookPage.service');
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class FacebookPageController {
  async list(req, res, next) { try { return ok(res, await service.list({ includeInactive: req.query.includeInactive === 'true', userId: req.user?.id })); } catch (error) { return next(error); } }
  async get(req, res, next) { try { return ok(res, await service.getPublic(req.params.id, req.user?.id)); } catch (error) { return next(error); } }
  async create(req, res, next) {
    try {
      if (!req.body.name || !req.body.pageId || !req.body.pageAccessToken) throw Object.assign(new Error('Name, Page ID, and page access token are required'), { status: 400 });
      return ok(res, await service.create(req.body, req.user?.id), 201);
    } catch (error) { return next(error); }
  }
  async update(req, res, next) { try { return ok(res, await service.update(req.params.id, req.body, req.user?.id)); } catch (error) { return next(error); } }
  async deactivate(req, res, next) { try { return ok(res, await service.deactivate(req.params.id, req.user?.id)); } catch (error) { return next(error); } }
  async verify(req, res, next) { try { return ok(res, await service.verifyConnection(req.params.id, req.user?.id)); } catch (error) { return next(error); } }
  async subscribeWebhook(req, res, next) { try { return ok(res, await service.subscribeWebhook(req.params.id, req.user?.id)); } catch (error) { return next(error); } }
}
module.exports = new FacebookPageController();
