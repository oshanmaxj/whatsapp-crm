const automationService = require('../services/automation.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class AutomationController {
  async list(req, res, next) {
    try { return ok(res, await automationService.getAutomations(req.query)); } catch (error) { return next(error); }
  }

  async get(req, res, next) {
    try { return ok(res, await automationService.getAutomation(req.params.id)); } catch (error) { return next(error); }
  }

  async update(req, res, next) {
    try { return ok(res, await automationService.updateAutomation(req.params.id, req.body)); } catch (error) { return next(error); }
  }

  async toggle(req, res, next) {
    try { return ok(res, await automationService.toggleAutomation(req.params.id, req.body.enabled)); } catch (error) { return next(error); }
  }

  async run(req, res, next) {
    try { return ok(res, await automationService.runAutomation(req.params.id), 201); } catch (error) { return next(error); }
  }

  async stats(req, res, next) {
    try { return ok(res, await automationService.getAutomationStats()); } catch (error) { return next(error); }
  }
}

module.exports = new AutomationController();
