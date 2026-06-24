const express = require('express');
const authMiddleware = require('../middleware/auth.middleware');
const requirePermission = require('../middleware/permission.middleware');
const whatsappSettingsController = require('../controllers/whatsappSettings.controller');

const router = express.Router();

router.use(authMiddleware.authenticate);

router.get('/settings', requirePermission('connect-whatsapp.view'), whatsappSettingsController.get.bind(whatsappSettingsController));
router.put('/settings', requirePermission('connect-whatsapp.edit'), whatsappSettingsController.save.bind(whatsappSettingsController));
router.post('/test-connection', requirePermission('connect-whatsapp.edit'), whatsappSettingsController.testConnection.bind(whatsappSettingsController));
router.post('/test-send', requirePermission('connect-whatsapp.send'), whatsappSettingsController.testSend.bind(whatsappSettingsController));

module.exports = router;
