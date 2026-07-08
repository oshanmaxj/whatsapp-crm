const logger = require('../config/logger');

module.exports = (err, req, res, next) => {
  const status = err.status || 500;
  const requestId = req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = {
    success: false,
    message: status >= 500 && !err.exposeMessage ? 'Internal server error' : (err.message || 'Request failed'),
    requestId
  };

  if (err.details) {
    response.details = err.details;
  }
  if (['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED', 'USER_DISABLED'].includes(err.code)) {
    response.code = err.code;
  }

  logger[status >= 500 ? 'error' : 'warn']('request_failed', {
    requestId,
    status,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id || null,
    error: err
  });

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
    response.message = err.message || response.message;
  }

  if (err.exposeResponseData && err.response?.data) {
    return res.status(err.response.status || status).json(err.response.data);
  }

  res.status(status).json(response);
};
