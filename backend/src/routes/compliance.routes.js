const express = require('express');
const complianceController = require('../controllers/compliance.controller');
const authMiddleware = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authMiddleware.authenticate);

router.get('/whatsapp-status', complianceController.whatsappStatus.bind(complianceController));
router.post('/message-check', complianceController.messageCheck.bind(complianceController));

module.exports = router;
