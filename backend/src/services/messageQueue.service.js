const { Op } = require('sequelize');
const { MessageQueue } = require('../models');
const whatsappService = require('./whatsapp.service');
const logger = require('../config/logger');

const RATE_LIMIT_PER_TICK = Number(process.env.QUEUE_RATE_LIMIT_PER_TICK || 5);

class MessageQueueService {
  async enqueue(payload, createdBy = null) {
    return MessageQueue.create({
      channel: payload.channel || 'whatsapp',
      messageType: payload.messageType || 'text',
      toNumber: payload.to || payload.toNumber,
      payload: payload.payload || payload,
      priority: payload.priority || 5,
      scheduledAt: payload.scheduledAt || new Date(),
      maxAttempts: payload.maxAttempts || 3,
      createdBy
    });
  }

  async list(query = {}) {
    const where = {};
    if (query.status) where.status = query.status;
    return MessageQueue.findAll({ where, order: [['priority', 'ASC'], ['scheduled_at', 'ASC']], limit: 200 });
  }

  async stats() {
    const rows = await MessageQueue.findAll({ attributes: ['status'], raw: true });
    return rows.reduce((acc, row) => ({ ...acc, [row.status]: (acc[row.status] || 0) + 1 }), {});
  }

  async processDue(limit = RATE_LIMIT_PER_TICK) {
    const rows = await MessageQueue.findAll({
      where: {
        status: { [Op.in]: ['queued', 'retrying'] },
        scheduledAt: { [Op.lte]: new Date() }
      },
      order: [['priority', 'ASC'], ['scheduled_at', 'ASC']],
      limit
    });

    const results = [];
    for (const row of rows) {
      results.push(await this.processOne(row));
    }
    return results;
  }

  async processOne(row) {
    await row.update({ status: 'processing', attempts: row.attempts + 1 });
    try {
      const response = await this.dispatch(row);
      await row.update({
        status: 'sent',
        processedAt: new Date(),
        externalMessageId: response?.id || response?.messages?.[0]?.id || null,
        lastError: null
      });
      return row;
    } catch (error) {
      const hasAttempts = row.attempts < row.maxAttempts;
      await row.update({
        status: hasAttempts ? 'retrying' : 'failed',
        lastError: error.message,
        nextAttemptAt: hasAttempts ? new Date(Date.now() + row.attempts * 60000) : null,
        scheduledAt: hasAttempts ? new Date(Date.now() + row.attempts * 60000) : row.scheduledAt
      });
      return row;
    }
  }

  async dispatch(row) {
    const payload = row.payload || {};
    if (row.channel !== 'whatsapp') return { id: `system-${row.id}` };
    if (row.messageType === 'template') return whatsappService.sendTemplateMessage(payload);
    if (['image', 'document', 'audio', 'video'].includes(row.messageType)) return whatsappService.sendMediaMessage({ ...payload, mediaType: row.messageType });
    return whatsappService.sendTextMessage({ to: row.toNumber, text: payload.text || payload.message || '' });
  }

  start(intervalMs = Number(process.env.QUEUE_WORKER_INTERVAL_MS || 15000)) {
    if (this.timer) return;
    this.timer = setInterval(() => this.processDue().catch((error) => logger.error('queue_worker_failed', error)), intervalMs);
  }
}

module.exports = new MessageQueueService();
