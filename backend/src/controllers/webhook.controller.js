const whatsappService = require('../services/whatsapp.service');
const whatsappSettingsService = require('../services/whatsappSettings.service');

class WebhookController {
  async verifyWebhook(req, res, next) {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      const settings = await whatsappSettingsService.getRaw();

      if (!settings.verifyToken) {
        return res.status(503).json({ success: false, message: 'WhatsApp webhook verify token is not configured' });
      }

      if (mode === 'subscribe' && token === settings.verifyToken) {
        await whatsappSettingsService.markWebhookVerified();
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
      next(error);
    }
  }
}

module.exports = new WebhookController();
