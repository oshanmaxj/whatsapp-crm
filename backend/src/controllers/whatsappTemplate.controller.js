const whatsappTemplateService = require('../services/whatsappTemplate.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class WhatsAppTemplateController {
  async list(req, res, next) { try { return ok(res, await whatsappTemplateService.list(req.query)); } catch (err) { next(err); } }
  async get(req, res, next) { try { return ok(res, await whatsappTemplateService.get(req.params.id)); } catch (err) { next(err); } }
  async create(req, res, next) { try { return ok(res, await whatsappTemplateService.create(req.body), 201); } catch (err) { next(err); } }
  async update(req, res, next) { try { return ok(res, await whatsappTemplateService.update(req.params.id, req.body)); } catch (err) { next(err); } }
  async delete(req, res, next) { try { return ok(res, await whatsappTemplateService.delete(req.params.id)); } catch (err) { next(err); } }
  async submit(req, res, next) { try { return ok(res, await whatsappTemplateService.submit(req.params.id)); } catch (err) { next(err); } }
  async sync(req, res, next) { try { return ok(res, await whatsappTemplateService.sync()); } catch (err) { next(err); } }
}

module.exports = new WhatsAppTemplateController();
