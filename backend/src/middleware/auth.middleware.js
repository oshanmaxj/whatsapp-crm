const jwt = require('jsonwebtoken');
const authService = require('../services/auth.service');
const sessionTimeout = require('./sessionTimeout.middleware');

exports.authenticate = (req, res, next) => {
  try {
    const authorization = req.headers.authorization;
    if (!authorization || !authorization.startsWith('Bearer ')) {
      const err = new Error('Authorization header is missing or invalid');
      err.status = 401;
      err.code = 'AUTH_REQUIRED';
      throw err;
    }

    const token = authorization.replace('Bearer ', '');
    const payload = authService.verifyAccessToken(token);

    req.user = payload;
    sessionTimeout(req, res, next);
  } catch (err) {
    err.status = err.status || 401;
    err.code = err.code || (err.name === 'TokenExpiredError' ? 'AUTH_EXPIRED' : 'AUTH_INVALID');
    next(err);
  }
};
