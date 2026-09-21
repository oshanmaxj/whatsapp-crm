const service = require('../services/facebookCommentAutoHideRule.service');
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class FacebookCommentAutoHideRuleController {
  async list(req, res, next) { try { return ok(res, await service.listRules({ facebookPageId: req.query.facebookPageId || null, userId: req.user?.id })); } catch (error) { return next(error); } }
  async create(req, res, next) { try { return ok(res, await service.createRule(req.body, req.user?.id), 201); } catch (error) { return next(error); } }
  async update(req, res, next) { try { return ok(res, await service.updateRule(req.params.id, req.body, req.user?.id)); } catch (error) { return next(error); } }
  async remove(req, res, next) { try { return ok(res, await service.deleteRule(req.params.id, req.user?.id)); } catch (error) { return next(error); } }
  async getSettings(req, res, next) { try { return ok(res, await service.getGlobalSettings()); } catch (error) { return next(error); } }
  async updateSettings(req, res, next) { try { return ok(res, await service.setGloballyEnabled(Boolean(req.body?.enabled), req.user?.id)); } catch (error) { return next(error); } }
}

module.exports = new FacebookCommentAutoHideRuleController();
