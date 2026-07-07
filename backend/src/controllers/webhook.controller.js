const whatsappService = require('../services/whatsapp.service');
const whatsappSettingsService = require('../services/whatsappSettings.service');
const logger = require('../config/logger');
const { WhatsAppAccount } = require('../models');

class WebhookController {
  async verifyWebhook(req, res, next) {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      const settings = await whatsappSettingsService.getRaw();
      const account = token ? await WhatsAppAccount.findOne({ where: { webhookVerifyToken: token, status: 'active' } }).catch(() => null) : null;

      if (!settings.verifyToken && !account) {
        return res.status(503).json({ success: false, message: 'WhatsApp webhook verify token is not configured' });
      }

      if (mode === 'subscribe' && (account || token === settings.verifyToken)) {
        if (!account) await whatsappSettingsService.markWebhookVerified();
        return res.status(200).send(challenge);
      }

      return res.status(403).json({ success: false, message: 'Webhook verification failed' });
    } catch (error) {
      next(error);
    }
  }

  async processWebhook(req, res, next) {
    try {
      await whatsappService.processWebhook(req.body);
      return res.status(200).json({ success: true, message: 'Webhook processed' });
    } catch (error) {
      logger.error('whatsapp_webhook_processing_failed', {
        message: error.message,
        stack: error.stack,
        validationErrors: Array.isArray(error.errors)
          ? error.errors.map((item) => item.message || String(item))
          : []
      });

      return res.status(200).json({
        success: true,
        message: 'Webhook received; processing encountered an internal error'
      });
    }
  }
}

module.exports = new WebhookController();
