const express = require('express');
const webhookController = require('../controllers/webhook.controller');

const router = express.Router();

router.get('/whatsapp', webhookController.verifyWebhook.bind(webhookController));
router.post('/whatsapp', webhookController.processWebhook.bind(webhookController));

module.exports = router;
