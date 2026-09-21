const service = require('../services/facebookComment.service');
const autoHideRuleService = require('../services/facebookCommentAutoHideRule.service');
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class FacebookCommentController {
  async list(req, res, next) { try { return ok(res, await service.list({ facebookPageId: req.query.facebookPageId || null, userId: req.user?.id })); } catch (error) { return next(error); } }
  async get(req, res, next) { try { return ok(res, await service.get(req.params.id, req.user?.id)); } catch (error) { return next(error); } }
  async reply(req, res, next) { try { return ok(res, await service.replyToComment(req.params.id, req.body, req.user?.id)); } catch (error) { return next(error); } }
  async hide(req, res, next) { try { return ok(res, await service.hideComment(req.params.id, req.user?.id)); } catch (error) { return next(error); } }
  async unhide(req, res, next) { try { return ok(res, await service.unhideComment(req.params.id, req.user?.id)); } catch (error) { return next(error); } }
  async retryAutoHide(req, res, next) { try { return ok(res, await autoHideRuleService.retryAutoHide(req.params.id, req.user?.id)); } catch (error) { return next(error); } }
}
module.exports = new FacebookCommentController();
