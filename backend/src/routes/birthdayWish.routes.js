const express = require('express');
const birthdayWishController = require('../controllers/birthdayWish.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);

router.get('/', birthdayWishController.list.bind(birthdayWishController));
router.get('/due', birthdayWishController.due.bind(birthdayWishController));
router.post('/send/:studentId', birthdayWishController.send.bind(birthdayWishController));
router.post('/send-bulk', birthdayWishController.sendBulk.bind(birthdayWishController));
router.get('/history', birthdayWishController.history.bind(birthdayWishController));
router.get('/report', birthdayWishController.report.bind(birthdayWishController));

module.exports = router;
