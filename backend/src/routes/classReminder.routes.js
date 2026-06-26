const express = require('express');
const classReminderController = require('../controllers/classReminder.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);

router.get('/', classReminderController.list.bind(classReminderController));
router.get('/due', classReminderController.due.bind(classReminderController));
router.post('/send/:batchId', classReminderController.send.bind(classReminderController));
router.post('/send-bulk', classReminderController.sendBulk.bind(classReminderController));
router.get('/history', classReminderController.history.bind(classReminderController));
router.get('/report', classReminderController.report.bind(classReminderController));

module.exports = router;
