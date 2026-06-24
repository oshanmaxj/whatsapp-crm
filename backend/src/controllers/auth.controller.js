const authService = require('../services/auth.service');
const userService = require('../services/user.service');
const { validateRequest } = require('../middleware/validate.middleware');

class AuthController {
  async register(req, res, next) {
    try {
      validateRequest(req);
      const payload = req.body;
      const result = await authService.register(payload);
      return res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async login(req, res, next) {
    try {
      validateRequest(req);
      const { email, password } = req.body;
      const result = await authService.login({ email, password });
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }

  async refreshToken(req, res, next) {
    try {
      validateRequest(req);
      const { refreshToken } = req.body;
      const payload = authService.verifyRefreshToken(refreshToken);
      const tokens = authService.generateTokens(payload);
      return res.status(200).json({ success: true, data: { tokens } });
    } catch (err) {
      next(err);
    }
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
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AuthController();
