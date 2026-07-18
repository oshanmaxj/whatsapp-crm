const path = require('path');
const { PaymentSlip } = require('../models');
const paymentSlipService = require('../services/paymentSlip.service');
const auditService = require('../services/audit.service');

class PaymentSlipController {
  async list(req, res, next) { try { res.json({ success: true, data: await paymentSlipService.list(req.query) }); } catch (error) { next(error); } }
  async get(req, res, next) { try { res.json({ success: true, data: await paymentSlipService.get(req.params.id) }); } catch (error) { next(error); } }
  async mark(req, res, next) {
    try {
      const existing = await PaymentSlip.findOne({ where: { whatsappMessageId: req.params.messageId } });
      const slip = existing || await paymentSlipService.detectMessage(req.params.messageId, { force: true });
      await auditService.record({ userId: req.user.id, action: 'PAYMENT_SLIP_MANUALLY_MARKED', entityType: 'payment_slip', entityId: slip.id, method: req.method, path: req.originalUrl, changes: { messageId: req.params.messageId, existing: Boolean(existing) } });
      res.status(existing ? 200 : 201).json({ success: true, data: await paymentSlipService.get(slip.id) });
    } catch (error) { next(error); }
  }
  async rerun(req, res, next) { try { const current = await PaymentSlip.findByPk(req.params.id); if (!current) throw Object.assign(new Error('Payment slip not found.'), { status: 404 }); const slip = await paymentSlipService.detectMessage(current.whatsappMessageId, { force: true }); res.json({ success: true, data: await paymentSlipService.get(slip.id) }); } catch (error) { next(error); } }
  async approve(req, res, next) { try { res.json({ success: true, data: await paymentSlipService.approvePaymentSlip({ slipId: req.params.id, reviewerUserId: req.user.id, ...req.body }) }); } catch (error) { next(error); } }
  async reject(req, res, next) { try { res.json({ success: true, data: await paymentSlipService.decide(req.params.id, 'reject', req.body, req.user.id) }); } catch (error) { next(error); } }
  async duplicate(req, res, next) { try { res.json({ success: true, data: await paymentSlipService.decide(req.params.id, 'duplicate', req.body, req.user.id) }); } catch (error) { next(error); } }
  async file(req, res, next) {
    try {
      const file = await paymentSlipService.file(req.params.id);
      await auditService.record({ userId: req.user.id, action: 'PAYMENT_SLIP_FILE_VIEWED', entityType: 'payment_slip', entityId: file.row.id, method: req.method, path: req.originalUrl });
      res.type(file.mimeType).set('Content-Disposition', `inline; filename="${path.basename(file.name).replace(/"/g, '')}"`).set('Cache-Control', 'private, no-store');
      res.sendFile(file.path);
    } catch (error) { next(error); }
  }
}
module.exports = new PaymentSlipController();
