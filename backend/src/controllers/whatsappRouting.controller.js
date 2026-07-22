const service = require('../services/whatsappRoutingAdmin.service');
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
module.exports = {
  async list(req, res, next) { try { return ok(res, await service.list(req.params.accountId, req.user.id)); } catch (error) { return next(error); } },
  async create(req, res, next) { try { return ok(res, await service.create(req.params.accountId, req.body, req.user.id), 201); } catch (error) { return next(error); } },
  async update(req, res, next) { try { return ok(res, await service.update(req.params.accountId, req.params.ruleId, req.body, req.user.id)); } catch (error) { return next(error); } },
  async remove(req, res, next) { try { return ok(res, await service.remove(req.params.accountId, req.params.ruleId, req.user.id)); } catch (error) { return next(error); } },
  async eligible(req, res, next) { try { return ok(res, await service.eligibleAgents(req.params.accountId, req.user.id, req.query)); } catch (error) { return next(error); } },
  async addAgent(req, res, next) { try { return ok(res, await service.upsertAgent(req.params.accountId, req.params.ruleId, req.body.agentId, req.body, req.user.id), 201); } catch (error) { return next(error); } },
  async updateAgent(req, res, next) { try { return ok(res, await service.upsertAgent(req.params.accountId, req.params.ruleId, req.params.agentId, req.body, req.user.id)); } catch (error) { return next(error); } },
  async removeAgent(req, res, next) { try { return ok(res, await service.removeAgent(req.params.accountId, req.params.ruleId, req.params.agentId, req.user.id)); } catch (error) { return next(error); } },
  async test(req, res, next) { try { if (req.body.simulate === false && !req.user.isSystemAdmin && !req.user.permissions?.includes('whatsapp_routing.edit')) return res.status(403).json({ success: false, message: 'Live routing test permission is required.' }); return ok(res, await service.test(req.params.accountId, req.body, req.user.id)); } catch (error) { return next(error); } },
  async analytics(req, res, next) { try { return ok(res, await service.analytics(req.params.accountId, req.user.id)); } catch (error) { return next(error); } }
};
