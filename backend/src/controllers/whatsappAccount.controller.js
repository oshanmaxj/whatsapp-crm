const service = require('../services/whatsappAccount.service');
const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class WhatsAppAccountController {
  async list(req, res, next) { try { return ok(res, await service.list({ includeInactive: req.query.includeInactive === 'true', userId: req.user?.id })); } catch (error) { return next(error); } }
  async get(req, res, next) { try { return ok(res, await service.getPublic(req.params.id, req.user?.id)); } catch (error) { return next(error); } }
  async create(req, res, next) {
    try {
      if (!req.body.name || !req.body.phoneNumberId || !req.body.accessToken) throw Object.assign(new Error('Name, phone number ID, and access token are required'), { status: 400 });
      return ok(res, await service.create(req.body, req.user?.id), 201);
    } catch (error) { return next(error); }
  }
  async update(req, res, next) { try { return ok(res, await service.update(req.params.id, req.body)); } catch (error) { return next(error); } }
  async deactivate(req, res, next) { try { return ok(res, await service.deactivate(req.params.id)); } catch (error) { return next(error); } }
  async setDefault(req, res, next) { try { return ok(res, await service.setDefault(req.params.id)); } catch (error) { return next(error); } }
  async test(req, res, next) { try { return ok(res, await service.testConnection(req.params.id)); } catch (error) { return next(error); } }
  async diagnostic(req, res, next) { try { return ok(res, await service.safeDiagnostic(req.params.id)); } catch (error) { return next(error); } }
}
module.exports = new WhatsAppAccountController();
