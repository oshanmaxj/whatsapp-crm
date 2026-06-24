const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { LoginHistory, PasswordResetToken, User } = require('../models');
const { accessTokenSecret, accessTokenExpiresIn, refreshTokenSecret, refreshTokenExpiresIn } = require('../config/jwt');

class AuthService {
  async register({ firstName, lastName, email, password, phone }) {
    const existing = await User.findOne({ where: { email } });
    if (existing) {
      const error = new Error('Email already registered');
      error.status = 409;
      throw error;
    }

    const user = await User.create({
      firstName,
      lastName,
      email,
      passwordHash: password,
      phone
    });

    return this.buildAuthResponse(user);
  }

  async login({ email, password }) {
    const user = await User.findOne({ where: { email } });
    if (!user) {
      await LoginHistory.create({ email, status: 'failed', reason: 'user_not_found' }).catch(() => null);
      const error = new Error('Invalid email or password');
      error.status = 401;
      throw error;
    }

    const valid = await user.verifyPassword(password);
    if (!valid) {
      await LoginHistory.create({ userId: user.id, email, status: 'failed', reason: 'invalid_password' }).catch(() => null);
      const error = new Error('Invalid email or password');
      error.status = 401;
      throw error;
    }

    user.lastLogin = new Date();
    await user.save();
    await LoginHistory.create({ userId: user.id, email, status: 'success' }).catch(() => null);

    return this.buildAuthResponse(user);
  }

  async requestPasswordReset(email) {
    const user = await User.findOne({ where: { email } });
    if (!user) return { requested: true };
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    await PasswordResetToken.create({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });
    return {
      requested: true,
      resetToken: process.env.NODE_ENV === 'production' ? undefined : token
    };
  }

  async resetPassword({ token, password }) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const reset = await PasswordResetToken.findOne({ where: { tokenHash, usedAt: null } });
    if (!reset || reset.expiresAt < new Date()) {
      const error = new Error('Password reset token is invalid or expired');
      error.status = 400;
      throw error;
    }
    const user = await User.findByPk(reset.userId);
    user.passwordHash = password;
    await user.save();
    await reset.update({ usedAt: new Date() });
    return { reset: true };
  }

  buildAuthResponse(user) {
    const tokens = this.generateTokens({ id: user.id, email: user.email, isSystemAdmin: user.isSystemAdmin });

    return {
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phone: user.phone,
        status: user.status,
        isSystemAdmin: user.isSystemAdmin
      },
      tokens
    };
  }

  generateTokens(payload) {
    const accessToken = jwt.sign(payload, accessTokenSecret, {
      expiresIn: accessTokenExpiresIn
    });

    const refreshToken = jwt.sign(payload, refreshTokenSecret, {
      expiresIn: refreshTokenExpiresIn
    });

    return { accessToken, refreshToken };
  }

  verifyAccessToken(token) {
    return jwt.verify(token, accessTokenSecret);
  }

  verifyRefreshToken(token) {
    return jwt.verify(token, refreshTokenSecret);
  }
}

module.exports = new AuthService();
