const auditService = require('../services/audit.service');
const logger = require('../config/logger');

module.exports = (req, res, next) => {
  res.on('finish', () => {
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return;
    if (req.path.includes('/auth/login')) return;
    auditService.record({
      userId: req.user?.id || null,
      action: `${req.method} ${req.path}`,
      entityType: req.path.split('/').filter(Boolean)[0] || 'api',
      method: req.method,
      path: req.originalUrl,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      changes: { statusCode: res.statusCode }
    }).catch((error) => logger.warn('audit_record_failed', error));
  });
  next();
};
