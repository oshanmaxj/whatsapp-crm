const appointmentService = require('../services/appointment.service');

class AppointmentController {
  async list(req, res, next) {
    try { return res.json({ success: true, data: await appointmentService.list(req.query) }); } catch (err) { next(err); }
  }

  async get(req, res, next) {
    try { return res.json({ success: true, data: await appointmentService.get(req.params.id) }); } catch (err) { next(err); }
  }

  async create(req, res, next) {
    try { return res.status(201).json({ success: true, data: await appointmentService.create(req.body, req.user?.id || null) }); } catch (err) { next(err); }
  }

  async update(req, res, next) {
    try { return res.json({ success: true, data: await appointmentService.update(req.params.id, req.body) }); } catch (err) { next(err); }
  }

  async remove(req, res, next) {
    try { return res.json({ success: true, data: await appointmentService.remove(req.params.id) }); } catch (err) { next(err); }
  }

  async confirm(req, res, next) {
    try { return res.json({ success: true, data: await appointmentService.confirm(req.params.id) }); } catch (err) { next(err); }
  }

  async cancel(req, res, next) {
    try { return res.json({ success: true, data: await appointmentService.cancel(req.params.id, req.body?.reason || null) }); } catch (err) { next(err); }
  }

  async reminder(req, res, next) {
    try { return res.json({ success: true, data: await appointmentService.reminder(req.params.id) }); } catch (err) { next(err); }
  }
}

module.exports = new AppointmentController();
