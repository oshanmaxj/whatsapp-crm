const express = require('express');
const webhookController = require('../controllers/webhook.controller');
const facebookWebhookController = require('../controllers/facebookWebhook.controller');
const smsWebhookController = require('../controllers/smsWebhook.controller');

const router = express.Router();

router.get('/whatsapp', webhookController.verifyWebhook.bind(webhookController));
router.post('/whatsapp', webhookController.processWebhook.bind(webhookController));

router.get('/facebook', facebookWebhookController.verifyWebhook.bind(facebookWebhookController));
router.post('/facebook', facebookWebhookController.processWebhook.bind(facebookWebhookController));

// Single generic path for every SMS provider — no per-provider verify
// handshake exists (unlike Meta's), so POST-only.
router.post('/sms', smsWebhookController.receive);

module.exports = router;
