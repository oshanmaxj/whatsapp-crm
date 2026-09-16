const facebookSettingsService = require('../services/facebookSettings.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

class FacebookSettingsController {
  async get(req, res, next) {
    try { return ok(res, await facebookSettingsService.getPublicMetadata()); }
    catch (error) { return next(error); }
  }

  async save(req, res, next) {
    try { return ok(res, await facebookSettingsService.save(req.body, req.user?.id || null)); }
    catch (error) { return next(error); }
  }

  async generateVerifyToken(req, res, next) {
    try { return ok(res, await facebookSettingsService.generateVerifyToken(req.user?.id || null)); }
    catch (error) { return next(error); }
  }

  async test(req, res, next) {
    try { return ok(res, await facebookSettingsService.testConfiguration()); }
    catch (error) { return next(error); }
  }
}

module.exports = new FacebookSettingsController();
