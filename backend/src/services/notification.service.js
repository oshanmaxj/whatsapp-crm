const { Notification } = require('../models');

class NotificationService {
  async list(userId, { unreadOnly } = {}) {
    const where = {};
    if (userId) where.userId = userId;
    if (unreadOnly === 'true' || unreadOnly === true) where.readAt = null;
    return Notification.findAll({ where, order: [['created_at', 'DESC']], limit: 100 });
  }

  async create(payload) {
    return Notification.create({
      userId: payload.userId || null,
      type: payload.type || 'system',
      title: payload.title,
      message: payload.message || null,
      data: payload.data || {}
    });
  }

  async markRead(id) {
    const row = await Notification.findByPk(id);
    if (!row) throw Object.assign(new Error('Notification not found'), { status: 404 });
    await row.update({ readAt: new Date() });
    return row;
  }
}

module.exports = new NotificationService();
