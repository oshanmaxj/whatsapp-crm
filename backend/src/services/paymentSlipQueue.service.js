const { Op } = require('sequelize');
const { PaymentSlipDetectionJob } = require('../models');
const paymentSlipService = require('./paymentSlip.service');
const logger = require('../config/logger');

class PaymentSlipQueueService {
  async enqueue(messageId) { return paymentSlipService.enqueue(messageId); }
  async processOne(job) {
    const [claimed] = await PaymentSlipDetectionJob.update(
      { status: 'PROCESSING', attempts: job.attempts + 1 },
      { where: { id: job.id, status: 'QUEUED' } }
    );
    if (!claimed) return null;
    job.status = 'PROCESSING'; job.attempts += 1;
    try {
      await paymentSlipService.detectMessage(job.messageId);
      await job.update({ status: 'COMPLETED', processedAt: new Date(), lastError: null });
    } catch (error) {
      const retry = job.attempts < job.maxAttempts && ![404, 413, 415, 422].includes(error.status);
      await job.update({ status: retry ? 'QUEUED' : 'FAILED', lastError: String(error.code || error.message).slice(0, 500), nextAttemptAt: retry ? new Date(Date.now() + job.attempts * 60000) : null });
      logger.warn('payment_slip_detection_failed', { jobId: job.id, messageId: job.messageId, code: error.code || null, retry });
    }
  }
  async processDue(limit = 5) {
    await PaymentSlipDetectionJob.update(
      { status: 'QUEUED', nextAttemptAt: new Date() },
      { where: { status: 'PROCESSING', updatedAt: { [Op.lt]: new Date(Date.now() - 10 * 60 * 1000) } } }
    );
    const jobs = await PaymentSlipDetectionJob.findAll({ where: { status: 'QUEUED', [Op.or]: [{ nextAttemptAt: null }, { nextAttemptAt: { [Op.lte]: new Date() } }] }, order: [['created_at', 'ASC']], limit });
    for (const job of jobs) await this.processOne(job);
  }
  start(interval = Number(process.env.PAYMENT_SLIP_WORKER_INTERVAL_MS || 10000)) {
    if (this.timer || process.env.PAYMENT_SLIP_DETECTION_ENABLED === 'false') return;
    this.timer = setInterval(() => this.processDue().catch((error) => logger.error('payment_slip_worker_failed', { message: error.message })), interval);
  }
}

module.exports = new PaymentSlipQueueService();
