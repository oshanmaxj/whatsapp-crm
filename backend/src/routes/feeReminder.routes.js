const express = require('express');
const feeReminderController = require('../controllers/feeReminder.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);

router.get('/', feeReminderController.list.bind(feeReminderController));
router.get('/due', feeReminderController.due.bind(feeReminderController));
router.post('/send/:installmentId', feeReminderController.send.bind(feeReminderController));
router.post('/send-bulk', feeReminderController.sendBulk.bind(feeReminderController));
router.get('/history', feeReminderController.history.bind(feeReminderController));
router.get('/report', feeReminderController.report.bind(feeReminderController));

module.exports = router;
