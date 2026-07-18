const crypto = require('crypto');
const { Op } = require('sequelize');
const { PaymentReceiptJob, sequelize } = require('../models');
const pdfService = require('./paymentReceiptPdf.service');
const deliveryService = require('./paymentReceiptDelivery.service');
const settingsService = require('./paymentReceiptSettings.service');
const logger = require('../config/logger');

class PaymentReceiptJobService {
  constructor(dependencies = {}) {
    this.Job = dependencies.PaymentReceiptJob || PaymentReceiptJob;
    this.sequelize = dependencies.sequelize || sequelize;
    this.pdfService = dependencies.pdfService || pdfService;
    this.deliveryService = dependencies.deliveryService || deliveryService;
    this.settingsService = dependencies.settingsService || settingsService;
    this.logger = dependencies.logger || logger;
    this.randomUUID = dependencies.randomUUID || crypto.randomUUID;
  }

  async enqueue(receiptId, jobType, { actorUserId = null, manual = false } = {}) {
    const stable = manual ? this.randomUUID() : 'auto';
    const dedupeKey = `receipt:${receiptId}:${jobType}:${stable}`;
    const [job] = await this.Job.findOrCreate({
      where: { dedupeKey },
      defaults: { receiptId, jobType, dedupeKey, actorUserId, manual, status: 'QUEUED', runAfter: new Date() }
    });
    setImmediate(() => this.processDue().catch((error) => this.logger.warn('payment_receipt_job_wakeup_failed', { message: error.message })));
    return job;
  }

  enqueuePdf(receiptId, options) { return this.enqueue(receiptId, 'GENERATE_PDF', options); }
  enqueueWhatsapp(receiptId, options) { return this.enqueue(receiptId, 'SEND_WHATSAPP', options); }

  async claimOne() {
    return this.sequelize.transaction(async (transaction) => {
      const job = await this.Job.findOne({
        where: { status: { [Op.in]: ['QUEUED', 'FAILED'] }, attempts: { [Op.lt]: this.sequelize.col('max_attempts') }, runAfter: { [Op.lte]: new Date() } },
        order: [['run_after', 'ASC'], ['id', 'ASC']], transaction,
        lock: transaction.LOCK.UPDATE, skipLocked: true
      });
      if (!job) return null;
      await job.update({ status: 'PROCESSING', attempts: job.attempts + 1, lastError: null }, { transaction });
      return job;
    });
  }

  async processDue(limit = 5) {
    const results = [];
    for (let index = 0; index < limit; index += 1) {
      const job = await this.claimOne();
      if (!job) break;
      results.push(await this.processOne(job));
    }
    return results;
  }

  async processOne(job) {
    try {
      if (job.jobType === 'GENERATE_PDF') {
        await this.pdfService.generate(job.receiptId);
        const settings = await this.settingsService.get();
        if (settings.autoSendWhatsapp && !job.manual) await this.enqueueWhatsapp(job.receiptId, { manual: false, actorUserId: job.actorUserId });
      } else if (job.jobType === 'SEND_WHATSAPP') {
        await this.deliveryService.send(job.receiptId, { manual: job.manual, actorUserId: job.actorUserId });
      } else {
        throw new Error(`Unsupported receipt job type: ${job.jobType}`);
      }
      await job.update({ status: 'COMPLETED', completedAt: new Date(), lastError: null });
    } catch (error) {
      const exhausted = job.attempts >= job.maxAttempts;
      await job.update({
        status: 'FAILED',
        runAfter: new Date(Date.now() + Math.min(job.attempts * 60000, 15 * 60000)),
        lastError: `${error.code || 'RECEIPT_JOB_FAILED'}: ${error.message}`.slice(0, 2000)
      });
      this.logger.warn('payment_receipt_job_failed', { jobId: job.id, receiptId: job.receiptId, jobType: job.jobType, attempts: job.attempts, exhausted, code: error.code || null, message: error.message });
    }
    return job;
  }

  start(intervalMs = Number(process.env.RECEIPT_JOB_INTERVAL_MS || 15000)) {
    if (this.timer) return;
    this.timer = setInterval(() => this.processDue().catch((error) => this.logger.warn('payment_receipt_worker_failed', { message: error.message })), intervalMs);
    this.timer.unref?.();
  }
}

module.exports = new PaymentReceiptJobService();
module.exports.createPaymentReceiptJobService = (dependencies) => new PaymentReceiptJobService(dependencies);
