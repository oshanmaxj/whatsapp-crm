const service = require('../services/facebookComment.service');
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class FacebookCommentController {
  async list(req, res, next) { try { return ok(res, await service.list({ facebookPageId: req.query.facebookPageId || null, userId: req.user?.id })); } catch (error) { return next(error); } }
  async get(req, res, next) { try { return ok(res, await service.get(req.params.id, req.user?.id)); } catch (error) { return next(error); } }
  async reply(req, res, next) { try { return ok(res, await service.replyToComment(req.params.id, req.body, req.user?.id)); } catch (error) { return next(error); } }
}
module.exports = new FacebookCommentController();
