const feeReminderService = require('../services/feeReminder.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class FeeReminderController {
  async list(req, res, next) { try { return ok(res, await feeReminderService.list(req.query)); } catch (err) { next(err); } }
  async due(req, res, next) { try { return ok(res, await feeReminderService.getDue()); } catch (err) { next(err); } }
  async send(req, res, next) { try { return ok(res, await feeReminderService.sendManualReminder(req.params.installmentId), 201); } catch (err) { next(err); } }
  async sendBulk(req, res, next) { try { return ok(res, await feeReminderService.sendBulkReminders()); } catch (err) { next(err); } }
  async history(req, res, next) { try { return ok(res, await feeReminderService.history(req.query)); } catch (err) { next(err); } }
  async report(req, res, next) { try { return ok(res, await feeReminderService.report(req.query)); } catch (err) { next(err); } }
}

module.exports = new FeeReminderController();
