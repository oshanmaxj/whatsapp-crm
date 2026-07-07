const flowService = require('../services/flow.service');
const whatsappAccountAccessService = require('../services/whatsappAccountAccess.service');

async function assertFlowAccess(req) {
  await flowService.get(req.params.id, req.user?.id);
  const requestedAccountId = req.body?.whatsappAccountId || req.body?.flow?.whatsappAccountId;
  if (requestedAccountId) {
    await whatsappAccountAccessService.assertAccess(requestedAccountId, req.user?.id);
  }
  const requestedDepartmentId = req.body?.departmentId || req.body?.flow?.departmentId;
  if (requestedDepartmentId) {
    await whatsappAccountAccessService.assertDepartmentAccess(requestedDepartmentId, req.user?.id);
  }
}

class FlowController {
  async list(req, res, next) {
    try { return res.json({ success: true, data: await flowService.list(req.user?.id) }); } catch (err) { next(err); }
  }

  async get(req, res, next) {
    try { return res.json({ success: true, data: await flowService.get(req.params.id, req.user?.id) }); } catch (err) { next(err); }
  }

  async create(req, res, next) {
    try { return res.status(201).json({ success: true, data: await flowService.create(req.body, req.user?.id || null) }); } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.update(req.params.id, req.body) }); } catch (err) { next(err); }
  }

  async remove(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.remove(req.params.id) }); } catch (err) { next(err); }
  }

  async saveBuilder(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.saveBuilder(req.params.id, req.body) }); } catch (err) { next(err); }
  }

  async uploadMedia(req, res, next) {
    try {
      await assertFlowAccess(req);
      return res.status(201).json({ success: true, data: await flowService.uploadFlowMedia(req.params.id, req.body) });
    } catch (err) { next(err); }
  }

  async publish(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.publish(req.params.id) }); } catch (err) { next(err); }
  }
  async unpublish(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.unpublish(req.params.id) }); } catch (err) { next(err); }
  }
  async duplicate(req, res, next) {
    try { await assertFlowAccess(req); return res.status(201).json({ success: true, data: await flowService.duplicate(req.params.id, req.user?.id || null) }); } catch (err) { next(err); }
  }
  async logs(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.logs(req.params.id) }); } catch (err) { next(err); }
  }
  async stats(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.analytics(req.params.id) }); } catch (err) { next(err); }
  }
  async createNode(req, res, next) {
    try { await assertFlowAccess(req); return res.status(201).json({ success: true, data: await flowService.createNode(req.params.id, req.body) }); } catch (err) { next(err); }
  }
  async updateNode(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.updateNode(req.params.id, req.params.nodeKey, req.body) }); } catch (err) { next(err); }
  }
  async deleteNode(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.deleteNode(req.params.id, req.params.nodeKey) }); } catch (err) { next(err); }
  }
  async createConnection(req, res, next) {
    try { await assertFlowAccess(req); return res.status(201).json({ success: true, data: await flowService.createConnection(req.params.id, req.body) }); } catch (err) { next(err); }
  }
  async deleteConnection(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.deleteConnection(req.params.id, req.params.connectionId) }); } catch (err) { next(err); }
  }

  async test(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.test(req.params.id, req.body || {}) }); } catch (err) { next(err); }
  }

  async analytics(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.analytics(req.params.id) }); } catch (err) { next(err); }
  }

  async runs(req, res, next) {
    try { await assertFlowAccess(req); return res.json({ success: true, data: await flowService.runs(req.params.id) }); } catch (err) { next(err); }
  }
}

module.exports = new FlowController();
