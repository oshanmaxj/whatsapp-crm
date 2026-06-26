const attendanceAlertService = require('../services/attendanceAlert.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class AttendanceAlertController {
  async list(req, res, next) { try { return ok(res, await attendanceAlertService.list(req.query)); } catch (error) { return next(error); } }
  async due(req, res, next) { try { return ok(res, await attendanceAlertService.getDue()); } catch (error) { return next(error); } }
  async send(req, res, next) { try { return ok(res, await attendanceAlertService.sendManualAlert(req.params.studentId, req.body), 201); } catch (error) { return next(error); } }
  async sendBulk(req, res, next) { try { return ok(res, await attendanceAlertService.sendBulkAlerts()); } catch (error) { return next(error); } }
  async history(req, res, next) { try { return ok(res, await attendanceAlertService.history(req.query)); } catch (error) { return next(error); } }
  async report(req, res, next) { try { return ok(res, await attendanceAlertService.getAttendanceAlertReport(req.query)); } catch (error) { return next(error); } }
}

module.exports = new AttendanceAlertController();
