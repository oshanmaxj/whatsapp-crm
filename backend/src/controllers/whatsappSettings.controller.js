const whatsappSettingsService = require('../services/whatsappSettings.service');
const studentPortalService = require('../services/studentPortal.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class WhatsappSettingsController {
  async get(req, res, next) {
    try {
      return ok(res, await whatsappSettingsService.getPublic());
    } catch (error) {
      return next(error);
    }
  }

  async save(req, res, next) {
    try {
      return ok(res, await whatsappSettingsService.save(req.body, req.user?.id || null));
    } catch (error) {
      return next(error);
    }
  }

  async testConnection(req, res, next) {
    try {
      return ok(res, await whatsappSettingsService.testConnection());
    } catch (error) {
      return next(error);
    }
  }

  async testSend(req, res, next) {
    try {
      return ok(res, await whatsappSettingsService.testSend(req.body));
    } catch (error) {
      return next(error);
    }
  }

  async testOtpConfiguration(req, res, next) {
    try {
      return ok(res, await studentPortalService.testOtpConfiguration());
    } catch (error) { return next(error); }
  }
}

module.exports = new WhatsappSettingsController();
