const classReminderService = require('../services/classReminder.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class ClassReminderController {
  async list(req, res, next) { try { return ok(res, await classReminderService.list(req.query)); } catch (err) { next(err); } }
  async due(req, res, next) { try { return ok(res, await classReminderService.getDue()); } catch (err) { next(err); } }
  async send(req, res, next) { try { return ok(res, await classReminderService.sendBatchReminders(req.params.batchId), 201); } catch (err) { next(err); } }
  async sendBulk(req, res, next) { try { return ok(res, await classReminderService.sendBulkReminders()); } catch (err) { next(err); } }
  async history(req, res, next) { try { return ok(res, await classReminderService.history(req.query)); } catch (err) { next(err); } }
  async report(req, res, next) { try { return ok(res, await classReminderService.report(req.query)); } catch (err) { next(err); } }
}

module.exports = new ClassReminderController();
