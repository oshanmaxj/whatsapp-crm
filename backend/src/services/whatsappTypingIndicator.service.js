const models = require('../models');
const messagingWindowService = require('./messagingWindow.service');
const whatsappService = require('./whatsapp.service');
const logger = require('../config/logger');
const { Op } = require('sequelize');

const THROTTLE_MS = 20_000;
const MAX_THROTTLE_ENTRIES = 10_000;

function createService(dependencies = {}) {
  const Message = dependencies.Message || models.Message;
  const Conversation = dependencies.Conversation || models.Conversation;
  const messagingWindow = dependencies.messagingWindowService || messagingWindowService;
  const whatsapp = dependencies.whatsappService || whatsappService;
  const log = dependencies.logger || logger;
  const now = dependencies.now || (() => Date.now());
  const throttle = dependencies.throttle || new Map();

  function cleanThrottle(current) {
    if (throttle.size < MAX_THROTTLE_ENTRIES) return;
    for (const [key, expiresAt] of throttle) if (expiresAt <= current) throttle.delete(key);
    while (throttle.size >= MAX_THROTTLE_ENTRIES) throttle.delete(throttle.keys().next().value);
  }

  return {
    async sendWhatsAppTypingIndicator({ conversationId, whatsappAccountId = null, inboundWhatsappMessageId = null, flowRunId = null }) {
      try {
        const conversation = await Conversation.findByPk(conversationId, { attributes: ['id', 'contactId', 'whatsappAccountId'] });
        if (!conversation) return { status: 'failed', reason: 'conversation_not_found' };
        const accountId = whatsappAccountId || conversation.whatsappAccountId;
        if (!accountId || String(accountId) !== String(conversation.whatsappAccountId)) {
          return { status: 'failed', reason: 'whatsapp_account_mismatch' };
        }

        const baseWhere = {
          conversationId: conversation.id,
          contactId: conversation.contactId,
          whatsappAccountId: accountId,
          direction: 'inbound',
          whatsappMessageId: { [Op.ne]: null }
        };
        let inbound = inboundWhatsappMessageId
          ? await Message.findOne({ where: { ...baseWhere, whatsappMessageId: String(inboundWhatsappMessageId) }, attributes: ['id', 'whatsappMessageId', 'createdAt'] })
          : await Message.findOne({ where: baseWhere, attributes: ['id', 'whatsappMessageId', 'createdAt'], order: [['created_at', 'DESC']] });
        if (!inbound && inboundWhatsappMessageId) {
          inbound = await Message.findOne({ where: baseWhere, attributes: ['id', 'whatsappMessageId', 'createdAt'], order: [['created_at', 'DESC']] });
        }
        if (!inbound?.whatsappMessageId) return { status: 'skipped_no_inbound_message' };

        const window = await messagingWindow.getMessagingWindow(conversation.id, accountId);
        if (!window.isOpen) return { status: 'skipped_window_closed' };

        const current = now();
        const throttleKey = `${accountId}:${conversation.id}`;
        if ((throttle.get(throttleKey) || 0) > current) return { status: 'skipped_throttled' };
        cleanThrottle(current);
        throttle.set(throttleKey, current + THROTTLE_MS);

        const response = await whatsapp.sendTypingIndicator({
          whatsappAccountId: accountId,
          inboundWhatsappMessageId: inbound.whatsappMessageId,
          conversationId: conversation.id,
          flowRunId
        });
        if (response?.success === false) {
          throttle.delete(throttleKey);
          return { status: 'failed', reason: 'meta_request_failed' };
        }
        return { status: 'sent', inboundMessageId: inbound.id };
      } catch (error) {
        log.warn('whatsapp_typing_indicator_resolution_failed', {
          conversationId, whatsappAccountId, reason: error.code || 'typing_indicator_failed'
        });
        return { status: 'failed', reason: error.code || 'typing_indicator_failed' };
      }
    },
    _throttle: throttle
  };
}

module.exports = createService();
module.exports.createService = createService;
module.exports.THROTTLE_MS = THROTTLE_MS;
