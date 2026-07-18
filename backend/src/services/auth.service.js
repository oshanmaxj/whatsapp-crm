const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { AuthSession, LoginHistory, PasswordResetToken, User } = require('../models');
const { accessTokenSecret, accessTokenExpiresIn, refreshTokenSecret, refreshTokenExpiresIn } = require('../config/jwt');
const userService = require('./user.service');

class AuthService {
  tokenHash(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
  sessionExpiry() { return new Date(Date.now() + Number(process.env.CRM_SESSION_DAYS || 30) * 86400000); }

  async register({ firstName, lastName, email, password, phone }) {
    if (await User.findOne({ where: { email } })) throw Object.assign(new Error('Email already registered'), { status: 409 });
    const user = await User.create({ firstName, lastName, email, passwordHash: password, phone });
    return this.buildAuthResponse(user);
  }

  async login({ email, password }, context = {}) {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      await LoginHistory.create({ email, status: 'failed', reason: 'user_not_found' }).catch(() => null);
      throw Object.assign(new Error('Invalid email or password'), { status: 401 });
    }
    if (user.status !== 'active') {
      await LoginHistory.create({ userId: user.id, email, status: 'failed', reason: 'user_inactive' }).catch(() => null);
      throw Object.assign(new Error('Account disabled. Contact admin.'), { status: 403, code: 'USER_DISABLED' });
    }
    if (!await user.verifyPassword(password)) {
      await LoginHistory.create({ userId: user.id, email, status: 'failed', reason: 'invalid_password' }).catch(() => null);
      throw Object.assign(new Error('Invalid email or password'), { status: 401 });
    }
    user.lastLogin = new Date();
    await user.save();
    await LoginHistory.create({ userId: user.id, email, status: 'success' }).catch(() => null);
    return this.buildAuthResponse(user, context);
  }

  async requestPasswordReset(email) {
    const user = await User.findOne({ where: { email } });
    if (!user) return { requested: true, emailDeliveryConfigured: this.isPasswordResetEmailConfigured() };
    const token = crypto.randomBytes(32).toString('hex');
    await PasswordResetToken.create({ userId: user.id, tokenHash: this.tokenHash(token), expiresAt: new Date(Date.now() + 3600000) });
    return { requested: true, emailDeliveryConfigured: this.isPasswordResetEmailConfigured(), resetToken: process.env.NODE_ENV === 'production' ? undefined : token };
  }

  isPasswordResetEmailConfigured() {
    return Boolean(process.env.PASSWORD_RESET_EMAIL_ENABLED === 'true' || (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS));
  }

  async resetPassword({ token, password }) {
    const reset = await PasswordResetToken.findOne({ where: { tokenHash: this.tokenHash(token), usedAt: null } });
    if (!reset || reset.expiresAt < new Date()) throw Object.assign(new Error('Password reset token is invalid or expired'), { status: 400 });
    const user = await User.findByPk(reset.userId);
    user.passwordHash = password;
    await user.save();
    await reset.update({ usedAt: new Date() });
    await this.revokeUserSessions(user.id);
    return { reset: true };
  }

  async changePassword(userId, { currentPassword, newPassword }) {
    const user = await User.findByPk(userId);
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    if (!await user.verifyPassword(currentPassword)) throw Object.assign(new Error('Current password is incorrect'), { status: 400 });
    user.passwordHash = newPassword;
    await user.save();
    await this.revokeUserSessions(user.id);
    return { changed: true };
  }

  async accessPayload(user) {
    const access = await userService.getUserAccessPayload(user.id);
    return { id: user.id, email: user.email, isSystemAdmin: user.isSystemAdmin, roles: access?.roles || [], permissions: access?.permissions || [] };
  }

  createRefreshToken(sessionId, userId, jti) {
    return jwt.sign({ type: 'refresh', sub: String(userId), sessionId, jti }, refreshTokenSecret, { expiresIn: refreshTokenExpiresIn });
  }

  async buildAuthResponse(user, context = {}) {
    const userAccess = await userService.getUserAccessPayload(user.id);
    const accessToken = jwt.sign(await this.accessPayload(user), accessTokenSecret, { expiresIn: accessTokenExpiresIn });
    const jti = crypto.randomBytes(32).toString('hex');
    const session = await AuthSession.create({
      userId: user.id, tokenHash: this.tokenHash(jti), expiresAt: this.sessionExpiry(),
      ipAddress: context.ipAddress || null, userAgent: String(context.userAgent || '').slice(0, 500) || null
    });
    return { user: userAccess, tokens: { accessToken, refreshToken: this.createRefreshToken(session.id, user.id, jti) } };
  }

  generateTokens(payload) {
    return {
      accessToken: jwt.sign(payload, accessTokenSecret, { expiresIn: accessTokenExpiresIn }),
      refreshToken: jwt.sign(payload, refreshTokenSecret, { expiresIn: refreshTokenExpiresIn })
    };
  }

  verifyAccessToken(token) { return jwt.verify(token, accessTokenSecret); }
  verifyRefreshToken(token) { return jwt.verify(token, refreshTokenSecret); }

  async refreshSession(token, context = {}) {
    if (!token) throw Object.assign(new Error('Refresh session is required'), { status: 401, code: 'AUTH_REFRESH_REQUIRED' });
    let payload;
    try { payload = this.verifyRefreshToken(token); } catch {
      throw Object.assign(new Error('Refresh session is invalid or expired'), { status: 401, code: 'AUTH_REFRESH_INVALID' });
    }
    if (payload.type !== 'refresh' || !payload.sessionId || !payload.jti) {
      const legacyUser = await User.findByPk(payload.id);
      if (!legacyUser || legacyUser.status !== 'active') throw Object.assign(new Error('Refresh session is invalid or expired'), { status: 401, code: 'AUTH_REFRESH_INVALID' });
      return this.buildAuthResponse(legacyUser, context);
    }
    const session = await AuthSession.findByPk(payload.sessionId);
    if (!session || this.tokenHash(payload.jti) !== session.tokenHash || session.revokedAt || new Date(session.expiresAt) <= new Date() || String(session.userId) !== String(payload.sub)) {
      throw Object.assign(new Error('Refresh session is invalid or expired'), { status: 401, code: 'AUTH_REFRESH_INVALID' });
    }
    const user = await User.findByPk(session.userId);
    if (!user || user.status !== 'active') {
      await session.update({ revokedAt: new Date() });
      throw Object.assign(new Error('Account is no longer active'), { status: 401, code: 'USER_DISABLED' });
    }
    const nextJti = crypto.randomBytes(32).toString('hex');
    await session.update({ tokenHash: this.tokenHash(nextJti), expiresAt: this.sessionExpiry(), lastUsedAt: new Date() });
    return {
      user: await userService.getUserAccessPayload(user.id),
      tokens: {
        accessToken: jwt.sign(await this.accessPayload(user), accessTokenSecret, { expiresIn: accessTokenExpiresIn }),
        refreshToken: this.createRefreshToken(session.id, user.id, nextJti)
      }
    };
  }

  async logout(token) {
    try {
      const payload = token ? this.verifyRefreshToken(token) : null;
      if (payload?.sessionId) await AuthSession.update({ revokedAt: new Date() }, { where: { id: payload.sessionId, revokedAt: null } });
    } catch { /* An invalid token is already unusable; still clear its cookie. */ }
    return { loggedOut: true };
  }

  async revokeUserSessions(userId) {
    await AuthSession.update({ revokedAt: new Date() }, { where: { userId, revokedAt: { [Op.is]: null } } });
  }
}

module.exports = new AuthService();
