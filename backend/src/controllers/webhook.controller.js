const whatsappService = require('../services/whatsapp.service');
const whatsappConfig = require('../config/whatsapp');

class WebhookController {
  verifyWebhook(req, res, next) {
    try {
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      if (mode === 'subscribe' && token === whatsappConfig.verifyToken) {
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