const whatsappService = require('../services/whatsapp.service');
const whatsappSettingsService = require('../services/whatsappSettings.service');
const logger = require('../config/logger');
const { WhatsAppAccount } = require('../models');
const crypto = require('crypto');
const whatsappAccountService = require('../services/whatsappAccount.service');

function signatureMatches(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret || !signature.startsWith('sha256=')) return false;
  const supplied = Buffer.from(signature.slice(7), 'hex');
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

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
      const phoneNumberId = req.body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
      if (phoneNumberId) {
        const config = await whatsappAccountService.runtimeConfig(null, { phoneNumberId }).catch(() => null);
        if (config?.appSecret && !signatureMatches(req.rawBody, req.headers['x-hub-signature-256'], config.appSecret)) {
          logger.warn('whatsapp_webhook_signature_invalid', { phoneNumberIdLastFour: String(phoneNumberId).slice(-4) });
          return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
        }
      }
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
module.exports.signatureMatches = signatureMatches;
