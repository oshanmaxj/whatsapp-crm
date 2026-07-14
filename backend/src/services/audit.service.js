const { AuditLog } = require('../models');

class AuditService {
  async record({ userId, action, entityType, entityId, method, path, ipAddress, userAgent, changes, transaction, required = false }) {
    const values = Object.fromEntries(Object.entries({
      userId: userId || null,
      action,
      entityType: entityType || null,
      entityId: entityId ? String(entityId) : null,
      method,
      path,
      ipAddress,
      userAgent,
      changes: changes || {}
    }).filter(([, value]) => value !== undefined));
    const write = AuditLog.create(values, { transaction });
    return required ? write : write.catch(() => null);
  }

  async list(query = {}) {
    const where = {};
    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = query.action;
    if (query.entityType) where.entityType = query.entityType;
    return AuditLog.findAll({ where, order: [['created_at', 'DESC']], limit: Math.min(Number(query.limit) || 100, 500) });
  }
}

module.exports = new AuditService();
