const authService = require('../services/auth.service');
const userService = require('../services/user.service');
const { validateRequest } = require('../middleware/validate.middleware');
const { clearRefreshCookie, readCookie, setRefreshCookie } = require('../utils/authCookie');

function publicAuthResult(result, res) {
  setRefreshCookie(res, result.tokens.refreshToken);
  return { user: result.user, tokens: { accessToken: result.tokens.accessToken } };
}

class AuthController {
  async register(req, res, next) {
    try {
      validateRequest(req);
      const payload = req.body;
      const result = await authService.register(payload);
      return res.status(201).json({ success: true, data: publicAuthResult(result, res) });
    } catch (err) {
      next(err);
    }
  }

  async login(req, res, next) {
    try {
      validateRequest(req);
      const { email, password } = req.body;
      const result = await authService.login({ email, password }, { ipAddress: req.ip, userAgent: req.get('user-agent') });
      return res.status(200).json({ success: true, data: publicAuthResult(result, res) });
    } catch (err) {
      next(err);
    }
  }

  async refreshToken(req, res, next) {
    try {
      const refreshToken = readCookie(req) || req.body?.refreshToken;
      const result = await authService.refreshSession(refreshToken, { ipAddress: req.ip, userAgent: req.get('user-agent') });
      return res.status(200).json({ success: true, data: publicAuthResult(result, res) });
    } catch (err) {
      next(err);
    }
  }

  async logout(req, res, next) {
    try {
      await authService.logout(readCookie(req) || req.body?.refreshToken);
      clearRefreshCookie(res);
      return res.status(200).json({ success: true, data: { loggedOut: true } });
    } catch (err) { return next(err); }
  }

  async requestPasswordReset(req, res, next) {
    try {
      const result = await authService.requestPasswordReset(req.body.email);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async resetPassword(req, res, next) {
    try {
      const result = await authService.resetPassword(req.body);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async me(req, res, next) {
    try {
      const user = await userService.getUserAccessPayload(req.user.id);
      return res.status(200).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }

  async updateMe(req, res, next) {
    try {
      const allowed = {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        phone: req.body.phone
      };
      const user = await userService.updateUser(req.user.id, allowed);
      return res.status(200).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }

  async changePassword(req, res, next) {
    try {
      const result = await authService.changePassword(req.user.id, req.body);
      clearRefreshCookie(res);
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuthController();
