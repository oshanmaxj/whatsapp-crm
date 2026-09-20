const crypto = require('crypto');
const logger = require('../config/logger');
const { SmsWebhookEvent } = require('../models');
const settingsService = require('../services/smsGatewaySettings.service');
const factory = require('../services/sms/smsProviderFactory');
const webhookService = require('../services/smsWebhook.service');

function isUniqueViolation(error) {
  return error?.name === 'SequelizeUniqueConstraintError' || error?.original?.code === '23505' || error?.parent?.code === '23505';
}

// Records a webhook delivery in the idempotency ledger before processing it,
// exactly mirroring facebookWebhook.controller.js's claimEvent()/
// markEventStatus() pattern. Returns false when this exact event_key was
// already recorded — that's what protects against a provider's at-least-once
// retry redelivery.
async function claimEvent({ eventKey, provider, eventType, payload }) {
  try {
    await SmsWebhookEvent.create({ eventKey, provider, eventType, payload, status: 'received' });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

async function markEventStatus(eventKey, status, errorDetails = null) {
  await SmsWebhookEvent.update(
    { status, processedAt: new Date(), errorDetails },
    { where: { eventKey } }
  ).catch(() => null);
}

// Single generic endpoint for every provider — which adapter handles a given
// delivery is resolved from the active SMS Gateway setting, not from the URL.
// This controller never inspects a signature header, a provider-specific
// payload field, or a provider-specific status string itself; all of that
// stays inside the active adapter (baseProvider.js contract).
exports.receive = async (req, res) => {
  let activeProvider = null;
  try {
    const config = await settingsService.getRuntimeConfig();
    activeProvider = config.activeProvider;
    const provider = factory.createProvider(config.activeProvider, config.providerConfig);

    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const verified = provider.capabilities.webhookSignature
      ? provider.verifyWebhookSignature({ headers: req.headers, rawBody })
      : true; // a provider without a signature scheme is documented via its capabilities, not assumed away here

    if (!verified) {
      // Never log the signature header or the API key it's keyed on.
      logger.warn('sms_webhook_signature_rejected', { provider: activeProvider });
      return res.status(401).json({ success: false, message: 'Invalid webhook signature.' });
    }

    const eventKey = `${activeProvider}:${crypto.createHash('sha256').update(rawBody).digest('hex')}`;
    const claimed = await claimEvent({
      eventKey, provider: activeProvider, eventType: req.body?.event || 'unknown', payload: req.body || {}
    });
    if (!claimed) {
      logger.info('sms_webhook_duplicate_ignored', { provider: activeProvider });
      return res.status(200).json({ success: true, duplicate: true });
    }

    try {
      const normalized = provider.normalizeWebhookEvent(req.body);
      const result = await webhookService.applyDeliveryEvent(normalized);
      await markEventStatus(eventKey, 'processed', result.applied ? null : `not applied: ${result.reason}`);
      return res.status(200).json({ success: true });
    } catch (processingError) {
      logger.error('sms_webhook_event_processing_failed', { provider: activeProvider, message: processingError.message });
      await markEventStatus(eventKey, 'failed', processingError.message);
      // Still 200: the request itself was valid and signed — a downstream
      // processing error shouldn't trigger endless provider retries. The
      // failure is recorded in the ledger for later inspection instead.
      return res.status(200).json({ success: true, warning: 'processing_error' });
    }
  } catch (error) {
    logger.error('sms_webhook_request_failed', { provider: activeProvider, message: error.message });
    return res.status(200).json({ success: true, warning: 'processing_error' });
  }
};
