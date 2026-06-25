const flowService = require('../services/flow.service');

class FlowController {
  async list(req, res, next) {
    try { return res.json({ success: true, data: await flowService.list() }); } catch (err) { next(err); }
  }

  async get(req, res, next) {
    try { return res.json({ success: true, data: await flowService.get(req.params.id) }); } catch (err) { next(err); }
  }

  async create(req, res, next) {
    try { return res.status(201).json({ success: true, data: await flowService.create(req.body, req.user?.id || null) }); } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try { return res.json({ success: true, data: await flowService.update(req.params.id, req.body) }); } catch (err) { next(err); }
  }

  async remove(req, res, next) {
    try { return res.json({ success: true, data: await flowService.remove(req.params.id) }); } catch (err) { next(err); }
  }

  async saveBuilder(req, res, next) {
    try { return res.json({ success: true, data: await flowService.saveBuilder(req.params.id, req.body) }); } catch (err) { next(err); }
  }

  async publish(req, res, next) {
    try { return res.json({ success: true, data: await flowService.publish(req.params.id) }); } catch (err) { next(err); }
  }

  async test(req, res, next) {
    try { return res.json({ success: true, data: await flowService.test(req.params.id, req.body || {}) }); } catch (err) { next(err); }
  }

  async analytics(req, res, next) {
    try { return res.json({ success: true, data: await flowService.analytics(req.params.id) }); } catch (err) { next(err); }
  }

  async runs(req, res, next) {
    try { return res.json({ success: true, data: await flowService.runs(req.params.id) }); } catch (err) { next(err); }
  }
}

module.exports = new FlowController();
