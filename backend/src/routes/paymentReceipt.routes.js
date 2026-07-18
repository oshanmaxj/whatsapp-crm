const express = require('express');
const controller = require('../controllers/paymentReceipt.controller');
const auth = require('../middleware/auth.middleware');
const permit = require('../middleware/permission.middleware');
const receiptJobs = require('../services/paymentReceiptJob.service');
const rateLimit = require('../middleware/rateLimit.middleware');

const router = express.Router();
router.get('/verify/:token', rateLimit({ windowMs: 60000, max: 30 }), controller.verify.bind(controller));
router.use(auth.authenticate);
router.get('/', permit('receipts.view'), controller.list.bind(controller));
router.get('/report', permit('receipts.view'), controller.report.bind(controller));
router.get('/export', permit('receipts.export'), controller.exportCsv.bind(controller));
router.get('/settings', permit('receipts.manage_settings'), controller.getSettings.bind(controller));
router.put('/settings', permit('receipts.manage_settings'), controller.updateSettings.bind(controller));
router.post('/payments/:paymentId/generate', permit('receipts.generate'), controller.generate.bind(controller));
router.get('/:id', permit('receipts.view'), controller.get.bind(controller));
router.get('/:id/pdf', permit('receipts.download'), controller.download.bind(controller));
router.post('/:id/regenerate', permit('receipts.regenerate'), controller.regenerate.bind(controller));
router.post('/:id/send-whatsapp', permit('receipts.send_whatsapp'), controller.sendWhatsapp.bind(controller));
router.post('/:id/void', permit('receipts.void'), controller.void.bind(controller));

receiptJobs.start();
module.exports = router;
