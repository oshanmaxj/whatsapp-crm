const crypto = require('crypto');
const logger = require('../config/logger');
const { FacebookPage, FacebookWebhookEvent } = require('../models');
const facebookMessengerService = require('../services/facebookMessenger.service');
const facebookCommentService = require('../services/facebookComment.service');
const facebookSettingsService = require('../services/facebookSettings.service');

function signatureMatches(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret || !signature.startsWith('sha256=')) return false;
  const supplied = Buffer.from(signature.slice(7), 'hex');
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

function isUniqueViolation(error) {
  return error?.name === 'SequelizeUniqueConstraintError' || error?.original?.code === '23505' || error?.parent?.code === '23505';
}

const pageCache = new Map();
async function resolvePage(pageId) {
  if (pageCache.has(pageId)) {
    const cached = pageCache.get(pageId);
    if (Date.now() - cached.at < 30000) return cached.page;
  }
  const page = await FacebookPage.findOne({ where: { pageId } });
  pageCache.set(pageId, { page, at: Date.now() });
  return page;
}

// Records a webhook delivery in the idempotency ledger before processing it.
// Returns false (and skips) when this exact event_key was already recorded —
// this is what protects against Meta's at-least-once retry redelivery.
async function claimEvent({ eventKey, eventType, objectType, facebookPageId, payload }) {
  try {
    await FacebookWebhookEvent.create({ eventKey, eventType, objectType, facebookPageId, payload, status: 'received' });
    return true;
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
}

async function markEventStatus(eventKey, status, errorDetails = null) {
  await FacebookWebhookEvent.update(
    { status, processedAt: new Date(), errorDetails },
    { where: { eventKey } }
  ).catch(() => null);
}

async function processMessagingItem(page, item) {
  const mid = item?.message?.mid;
  const eventKey = `messaging:${page.pageId}:${mid || `${item?.sender?.id || 'unknown'}:${item?.timestamp || Date.now()}`}`;
  const claimed = await claimEvent({
    eventKey, eventType: 'messaging', objectType: 'page', facebookPageId: page.id, payload: item
  });
  if (!claimed) {
    logger.info('facebook_webhook_duplicate_event', { eventKey });
    return;
  }
  try {
    if (item?.postback) await facebookMessengerService.handleInboundPostbackEvent(page, item);
    else await facebookMessengerService.handleInboundMessagingEvent(page, item);
    await markEventStatus(eventKey, 'processed');
  } catch (error) {
    logger.error('facebook_messenger_inbound_failed', { facebookPageId: page.id, message: error.message, stack: error.stack });
    await markEventStatus(eventKey, 'failed', error.message);
  }
}

async function processFeedChange(page, change) {
  const value = change?.value || {};
  if (value.item !== 'comment') return;
  const verb = value.verb || 'add';
  const eventKey = `comment:${page.pageId}:${value.comment_id}:${verb}`;
  const claimed = await claimEvent({
    eventKey, eventType: 'comment', objectType: 'page', facebookPageId: page.id, payload: change
  });
  if (!claimed) {
    logger.info('facebook_webhook_duplicate_event', { eventKey });
    return;
  }
  try {
    if (verb === 'remove') {
      const { FacebookComment } = require('../models');
      await FacebookComment.update({ deleted: true }, { where: { metaCommentId: value.comment_id } });
    } else if (verb === 'edited') {
      const { FacebookComment } = require('../models');
      await FacebookComment.update({ message: value.message || null }, { where: { metaCommentId: value.comment_id } });
    } else {
      await facebookCommentService.ingestComment({
        facebookPageId: page.id,
        metaCommentId: value.comment_id,
        metaPostId: value.post_id,
        parentCommentId: value.parent_id && value.parent_id !== value.post_id ? value.parent_id : null,
        psid: value.from?.id || null,
        displayName: value.from?.name || null,
        message: value.message || null,
        createdTime: value.created_time ? new Date(Number(value.created_time) * 1000) : new Date()
      });
    }
    await markEventStatus(eventKey, 'processed');
  } catch (error) {
    logger.error('facebook_comment_ingest_failed', { facebookPageId: page.id, message: error.message, stack: error.stack });
    await markEventStatus(eventKey, 'failed', error.message);
  }
}

class FacebookWebhookController {
  async verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    let verifyToken;
    try {
      ({ webhookVerifyToken: verifyToken } = await facebookSettingsService.getRuntimeConfig());
    } catch (error) {
      logger.error('facebook_webhook_config_load_failed', { message: error.message });
      return res.status(503).json({ success: false, message: 'Facebook webhook verify token is not configured' });
    }

    if (!verifyToken) {
      return res.status(503).json({ success: false, message: 'Facebook webhook verify token is not configured' });
    }
    // Never log the received or stored token, even on failure.
    if (mode === 'subscribe' && token === verifyToken) {
      logger.info('facebook_webhook_verified');
      return res.status(200).send(challenge);
    }
    logger.warn('facebook_webhook_verification_failed');
    return res.status(403).json({ success: false, message: 'Webhook verification failed' });
  }

  async processWebhook(req, res) {
    try {
      logger.info('facebook_webhook_received', { object: req.body?.object, entries: Array.isArray(req.body?.entry) ? req.body.entry.length : 0 });

      const { appSecret } = await facebookSettingsService.getRuntimeConfig();
      if (appSecret) {
        if (!signatureMatches(req.rawBody, req.headers['x-hub-signature-256'], appSecret)) {
          logger.warn('facebook_webhook_signature_invalid');
          return res.status(401).json({ success: false, message: 'Invalid webhook signature' });
        }
      } else {
        logger.warn('facebook_webhook_signature_check_skipped_no_secret');
      }

      if (req.body?.object !== 'page') {
        return res.status(200).json({ success: true, message: 'Ignored: not a Page object' });
      }

      const entries = Array.isArray(req.body.entry) ? req.body.entry : [];
      for (const entry of entries) {
        try {
          const pageId = entry?.id;
          if (!pageId) continue;
          const page = await resolvePage(pageId);
          if (!page) {
            logger.warn('facebook_webhook_unknown_page', { pageId });
            continue;
          }
          logger.info('facebook_page_resolved', { facebookPageId: page.id });

          const messaging = Array.isArray(entry.messaging) ? entry.messaging : [];
          for (const item of messaging) {
            try {
              await processMessagingItem(page, item);
            } catch (itemError) {
              logger.error('facebook_webhook_messaging_item_failed', { facebookPageId: page.id, message: itemError.message });
            }
          }

          const changes = Array.isArray(entry.changes) ? entry.changes : [];
          for (const change of changes) {
            try {
              await processFeedChange(page, change);
            } catch (changeError) {
              logger.error('facebook_webhook_change_item_failed', { facebookPageId: page.id, message: changeError.message });
            }
          }
        } catch (entryError) {
          logger.error('facebook_webhook_entry_failed', { message: entryError.message, stack: entryError.stack });
        }
      }

      return res.status(200).json({ success: true, message: 'Webhook processed' });
    } catch (error) {
      logger.error('facebook_webhook_processing_failed', { message: error.message, stack: error.stack });
      return res.status(200).json({ success: true, message: 'Webhook received; processing encountered an internal error' });
    }
  }
}

module.exports = new FacebookWebhookController();
module.exports.signatureMatches = signatureMatches;
