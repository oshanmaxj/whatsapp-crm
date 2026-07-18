const { PaymentReceipt, sequelize } = require('../models');
const receiptService = require('../services/paymentReceipt.service');
const jobService = require('../services/paymentReceiptJob.service');
const settingsService = require('../services/paymentReceiptSettings.service');
const receiptStorageService = require('../services/paymentReceiptStorage.service');
const auditService = require('../services/audit.service');
const deliveryService = require('../services/paymentReceiptDelivery.service');

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;

function safeReceipt(receipt) {
  const value = receipt?.toJSON ? receipt.toJSON() : { ...(receipt || {}) };
  delete value.verificationTokenHash;
  delete value.verificationTokenEncrypted;
  return value;
}

function maskName(name) {
  return String(name || '').split(/\s+/).filter(Boolean).map((part) => part.length < 2 ? '*' : `${part[0]}${'*'.repeat(Math.min(part.length - 1, 5))}`).join(' ');
}

class PaymentReceiptController {
  async verify(req, res, next) {
    try {
      const receipt = await receiptService.findPublic(req.params.token);
      if (!receipt) return ok(res, { valid: false });
      return ok(res, {
        valid: true,
        receiptNumber: receipt.receiptNumber,
        receiptDate: receipt.receiptDate,
        studentName: maskName(receipt.studentNameSnapshot),
        course: receipt.courseNameSnapshot,
        amount: receipt.paidAmount,
        currency: receipt.currency,
        status: receipt.status
      });
    } catch (error) { next(error); }
  }

  async list(req, res, next) {
    try { return ok(res, (await receiptService.list(req.query)).map(safeReceipt)); } catch (error) { next(error); }
  }

  async get(req, res, next) {
    try {
      const receipt = await PaymentReceipt.findByPk(req.params.id);
      if (!receipt) throw Object.assign(new Error('Receipt not found'), { status: 404 });
      await auditService.record({ userId: req.user?.id, action: 'PAYMENT_RECEIPT_VIEWED', entityType: 'payment_receipt', entityId: receipt.id, method: 'GET', path: req.originalUrl });
      return ok(res, safeReceipt(receipt));
    } catch (error) { next(error); }
  }

  async generate(req, res, next) {
    try {
      const result = await receiptService.generatePaymentReceipt({
        paymentId: req.params.paymentId,
        actorType: 'USER', actorUserId: req.user?.id,
        generationSource: req.body?.generationSource || 'ADMIN_REGENERATE'
      });
      return ok(res, { receipt: safeReceipt(result.receipt), created: result.created }, result.created ? 201 : 200);
    } catch (error) { next(error); }
  }

  async download(req, res, next) {
    try {
      const receipt = await PaymentReceipt.findByPk(req.params.id);
      if (!receipt) throw Object.assign(new Error('Receipt not found'), { status: 404 });
      if (!receipt.pdfStorageKey) throw Object.assign(new Error('Receipt PDF is still being generated'), { status: 409, code: 'RECEIPT_PDF_PENDING' });
      await auditService.record({ userId: req.user?.id, action: 'PAYMENT_RECEIPT_DOWNLOADED', entityType: 'payment_receipt', entityId: receipt.id, method: 'GET', path: req.originalUrl });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${receipt.receiptNumber}.pdf"`);
      return res.sendFile(receiptStorageService.resolveKey(receipt.pdfStorageKey));
    } catch (error) { next(error); }
  }

  async regenerate(req, res, next) {
    try {
      const receipt = await PaymentReceipt.findByPk(req.params.id);
      if (!receipt) throw Object.assign(new Error('Receipt not found'), { status: 404 });
      const job = await jobService.enqueuePdf(receipt.id, { actorUserId: req.user?.id, manual: true });
      await auditService.record({ userId: req.user?.id, action: 'PAYMENT_RECEIPT_PDF_REGENERATED', entityType: 'payment_receipt', entityId: receipt.id, changes: { jobId: job.id } });
      return ok(res, { jobId: job.id, status: job.status }, 202);
    } catch (error) { next(error); }
  }

  async sendWhatsapp(req, res, next) {
    try {
      const receipt = await PaymentReceipt.findByPk(req.params.id);
      if (!receipt) throw Object.assign(new Error('Receipt not found'), { status: 404 });
      await deliveryService.preflight(receipt.id);
      const job = await jobService.enqueueWhatsapp(receipt.id, { actorUserId: req.user?.id, manual: true });
      await auditService.record({ userId: req.user?.id, action: 'PAYMENT_RECEIPT_WHATSAPP_QUEUED', entityType: 'payment_receipt', entityId: receipt.id, changes: { jobId: job.id, manual: true } });
      return ok(res, { jobId: job.id, status: job.status }, 202);
    } catch (error) { next(error); }
  }

  async void(req, res, next) {
    try {
      const reason = String(req.body?.reason || '').trim();
      if (reason.length < 5) throw Object.assign(new Error('A meaningful void reason is required'), { status: 422, code: 'RECEIPT_VOID_REASON_REQUIRED' });
      const receipt = await sequelize.transaction(async (transaction) => {
        const row = await PaymentReceipt.findByPk(req.params.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!row) throw Object.assign(new Error('Receipt not found'), { status: 404 });
        if (row.status === 'REVERSED') throw Object.assign(new Error('A reversed receipt cannot be voided'), { status: 409 });
        if (row.status !== 'VOID') await row.update({ status: 'VOID', voidReason: reason, voidedByUserId: req.user?.id || null, voidedAt: new Date() }, { transaction });
        await auditService.record({ userId: req.user?.id, action: 'PAYMENT_RECEIPT_VOIDED', entityType: 'payment_receipt', entityId: row.id, transaction, required: true, changes: { reason } });
        return row;
      });
      await jobService.enqueuePdf(receipt.id, { actorUserId: req.user?.id, manual: true });
      return ok(res, safeReceipt(receipt));
    } catch (error) { next(error); }
  }

  async report(req, res, next) {
    try {
      const rows = await receiptService.list({ ...req.query, limit: 1000 });
      const totals = rows.reduce((summary, row) => {
        summary.count += 1;
        summary.amount += Number(row.paidAmount || 0);
        summary.sent += row.whatsappSentAt ? 1 : 0;
        summary.status[row.status] = (summary.status[row.status] || 0) + 1;
        summary.byMethod[row.paymentMethod || 'Unknown'] = (summary.byMethod[row.paymentMethod || 'Unknown'] || 0) + Number(row.paidAmount || 0);
        summary.byCourse[row.courseNameSnapshot || 'Unknown'] = (summary.byCourse[row.courseNameSnapshot || 'Unknown'] || 0) + Number(row.paidAmount || 0);
        return summary;
      }, { count: 0, amount: 0, sent: 0, status: {}, byMethod: {}, byCourse: {} });
      return ok(res, { ...totals, notSent: totals.count - totals.sent });
    } catch (error) { next(error); }
  }

  async exportCsv(req, res, next) {
    try {
      const rows = await receiptService.list({ ...req.query, limit: 1000 });
      const fields = ['receiptNumber', 'studentNameSnapshot', 'studentNumberSnapshot', 'courseNameSnapshot', 'batchNameSnapshot', 'paidAmount', 'currency', 'receiptDate', 'paymentMethod', 'status', 'whatsappSentAt'];
      const csv = [fields.join(','), ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(','))].join('\r\n');
      await auditService.record({ userId: req.user?.id, action: 'PAYMENT_RECEIPTS_EXPORTED', entityType: 'payment_receipt', changes: { count: rows.length } });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="payment-receipts.csv"');
      return res.send(csv);
    } catch (error) { next(error); }
  }

  async getSettings(req, res, next) { try { return ok(res, await settingsService.get()); } catch (error) { next(error); } }
  async updateSettings(req, res, next) {
    try {
      const settings = await settingsService.update(req.body, req.user?.id);
      await auditService.record({ userId: req.user?.id, action: 'PAYMENT_RECEIPT_SETTINGS_UPDATED', entityType: 'app_setting', changes: { fields: Object.keys(req.body || {}) } });
      return ok(res, settings);
    } catch (error) { next(error); }
  }
}

module.exports = new PaymentReceiptController();
module.exports.safeReceipt = safeReceipt;
