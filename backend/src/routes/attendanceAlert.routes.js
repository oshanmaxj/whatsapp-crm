const express = require('express');
const attendanceAlertController = require('../controllers/attendanceAlert.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);

router.get('/', attendanceAlertController.list.bind(attendanceAlertController));
router.get('/due', attendanceAlertController.due.bind(attendanceAlertController));
router.post('/send/:studentId', attendanceAlertController.send.bind(attendanceAlertController));
router.post('/send-bulk', attendanceAlertController.sendBulk.bind(attendanceAlertController));
router.get('/history', attendanceAlertController.history.bind(attendanceAlertController));
router.get('/report', attendanceAlertController.report.bind(attendanceAlertController));

module.exports = router;
