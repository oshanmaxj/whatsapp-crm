const logger = require('../config/logger');

module.exports = (err, req, res, next) => {
  const status = err.status || 500;
  const requestId = req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = {
    success: false,
    message: status >= 500 ? 'Internal server error' : (err.message || 'Request failed'),
    requestId
  };

  if (err.details) {
    response.details = err.details;
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

  res.status(status).json(response);
};
