const { Op } = require('sequelize');
const { Message, Conversation, WhatsAppTemplate } = require('../models');

const WINDOW_MS = 24 * 60 * 60 * 1000;

// Verified against current Meta documentation (developers.facebook.com/
// documentation/business-messaging/whatsapp/pricing and .../free-entry-point,
// cross-checked 2026-10): a Free Entry Point conversation (Click-to-WhatsApp
// ad or a Facebook/Instagram Page "Message" CTA) opens for 72 hours, but
// ONLY once the business sends a qualifying response within 24 hours of the
// customer's referral-tagged entry message. A late response never opens it.
const FREE_ENTRY_WINDOW_MS = 72 * 60 * 60 * 1000;
const QUALIFYING_RESPONSE_DEADLINE_MS = 24 * 60 * 60 * 1000;

function calculateMessagingWindow(openedAt, now = new Date()) {
  if (!openedAt) return { isOpen: false, openedAt: null, expiresAt: null, remainingSeconds: 0, reason: 'NO_INBOUND_CUSTOMER_MESSAGE' };
  const opened = new Date(openedAt);
  const expires = new Date(opened.getTime() + WINDOW_MS);
  const remainingSeconds = Math.max(0, Math.ceil((expires.getTime() - new Date(now).getTime()) / 1000));
  return {
    isOpen: new Date(now).getTime() < expires.getTime(),
    openedAt: opened.toISOString(),
    expiresAt: expires.toISOString(),
    remainingSeconds,
    reason: 'CUSTOMER_SERVICE_WINDOW'
  };
}

// Pure calculation — never infers eligibility from anything but verified
// referral evidence and an actual recorded business response. `status`
// distinguishes every state the dashboard/inbox need to show distinctly:
//   unknown            — no referral-tagged entry message found at all.
//   pending_response   — a referral entry exists, business hasn't replied yet
//                        (still within its own 24h reply deadline).
//   not_qualified      — the business replied, but later than 24h after entry
//                        (or never replied and the 24h reply deadline passed).
//   active / expired   — a qualifying reply opened the 72h window on time.
function calculateFreeEntryWindow({ referralAt, responseAt, now = new Date() } = {}) {
  const nowMs = new Date(now).getTime();
  if (!referralAt) return { eligible: false, status: 'unknown', referralAt: null, responseAt: null, windowStart: null, expiresAt: null, remainingSeconds: 0, reason: 'NO_REFERRAL_EVIDENCE' };
  const referral = new Date(referralAt);
  const replyDeadline = new Date(referral.getTime() + QUALIFYING_RESPONSE_DEADLINE_MS);
  if (!responseAt) {
    if (nowMs <= replyDeadline.getTime()) {
      return { eligible: false, status: 'pending_response', referralAt: referral.toISOString(), responseAt: null, windowStart: null, expiresAt: null, remainingSeconds: 0, reason: 'AWAITING_QUALIFYING_RESPONSE', replyDeadline: replyDeadline.toISOString() };
    }
    return { eligible: false, status: 'not_qualified', referralAt: referral.toISOString(), responseAt: null, windowStart: null, expiresAt: null, remainingSeconds: 0, reason: 'NO_RESPONSE_WITHIN_24H', replyDeadline: replyDeadline.toISOString() };
  }
  const response = new Date(responseAt);
  if (response.getTime() > replyDeadline.getTime()) {
    return { eligible: false, status: 'not_qualified', referralAt: referral.toISOString(), responseAt: response.toISOString(), windowStart: null, expiresAt: null, remainingSeconds: 0, reason: 'LATE_RESPONSE', replyDeadline: replyDeadline.toISOString() };
  }
  const expires = new Date(response.getTime() + FREE_ENTRY_WINDOW_MS);
  const remainingSeconds = Math.max(0, Math.ceil((expires.getTime() - nowMs) / 1000));
  return {
    eligible: true,
    status: nowMs < expires.getTime() ? 'active' : 'expired',
    referralAt: referral.toISOString(),
    responseAt: response.toISOString(),
    windowStart: response.toISOString(),
    expiresAt: expires.toISOString(),
    remainingSeconds,
    reason: 'FREE_ENTRY_POINT_WINDOW'
  };
}

class MessagingWindowService {
  async getMessagingWindow(conversationId, whatsappAccountId, { transaction = null, now = new Date() } = {}) {
    if (!conversationId || !whatsappAccountId) throw Object.assign(new Error('Conversation and WhatsApp account are required.'), { status: 422, code: 'WHATSAPP_ACCOUNT_MISMATCH' });
    const conversation = await Conversation.findByPk(conversationId, { attributes: ['id', 'contactId', 'whatsappAccountId'], transaction });
    if (!conversation) throw Object.assign(new Error('Conversation not found.'), { status: 404, code: 'CONVERSATION_NOT_FOUND' });
    if (String(conversation.whatsappAccountId) !== String(whatsappAccountId)) throw Object.assign(new Error('Conversation belongs to a different WhatsApp account.'), { status: 409, code: 'WHATSAPP_ACCOUNT_MISMATCH' });
    const inbound = await Message.findOne({
      where: { conversationId, contactId: conversation.contactId, whatsappAccountId, direction: 'inbound' },
      attributes: ['createdAt'], order: [['created_at', 'DESC']], transaction
    });
    return calculateMessagingWindow(inbound?.createdAt, now);
  }

  // Resolves the 72-hour Free Entry Point window from canonical Message
  // rows only — never from a contact/lead's recorded source, and never
  // from any field other than this conversation's own referral-tagged
  // inbound message. The most recent referral-bearing inbound message is
  // treated as the entry event (an older one, if any, would already be
  // superseded or expired); "qualifying response" is the first outbound
  // message sent afterward, matching the "reply within 24h" rule exactly —
  // not any later outbound message.
  async getFreeEntryWindow(conversationId, whatsappAccountId, { transaction = null, now = new Date() } = {}) {
    if (!conversationId || !whatsappAccountId) throw Object.assign(new Error('Conversation and WhatsApp account are required.'), { status: 422, code: 'WHATSAPP_ACCOUNT_MISMATCH' });
    const conversation = await Conversation.findByPk(conversationId, { attributes: ['id', 'whatsappAccountId'], transaction });
    if (!conversation) throw Object.assign(new Error('Conversation not found.'), { status: 404, code: 'CONVERSATION_NOT_FOUND' });
    if (String(conversation.whatsappAccountId) !== String(whatsappAccountId)) throw Object.assign(new Error('Conversation belongs to a different WhatsApp account.'), { status: 409, code: 'WHATSAPP_ACCOUNT_MISMATCH' });
    const referral = await Message.findOne({
      where: {
        conversationId, whatsappAccountId, direction: 'inbound',
        [Op.or]: [{ referralSourceType: { [Op.ne]: null } }, { ctwaClid: { [Op.ne]: null } }]
      },
      attributes: ['createdAt'], order: [['created_at', 'DESC']], transaction
    });
    if (!referral) return calculateFreeEntryWindow({ now });
    const response = await Message.findOne({
      where: { conversationId, whatsappAccountId, direction: 'outbound', createdAt: { [Op.gt]: referral.createdAt } },
      attributes: ['createdAt'], order: [['created_at', 'ASC']], transaction
    });
    return calculateFreeEntryWindow({ referralAt: referral.createdAt, responseAt: response?.createdAt || null, now });
  }

  // The single canonical lookup other code (inbox detail view, Flow Builder
  // sending decisions, future callers) should use when both windows are
  // needed — guarantees the 24h and 72h results always come from the same
  // `now` and the same conversation/account validation, run once.
  async getBothWindows(conversationId, whatsappAccountId, options = {}) {
    const now = options.now || new Date();
    const [serviceWindow, freeEntryWindow] = await Promise.all([
      this.getMessagingWindow(conversationId, whatsappAccountId, { ...options, now }),
      this.getFreeEntryWindow(conversationId, whatsappAccountId, { ...options, now })
    ]);
    return { serviceWindow, freeEntryWindow };
  }

  async authorizeSessionMessage({ conversationId, whatsappAccountId, templateId = null, transaction = null, now = new Date() }) {
    const messagingWindow = await this.getMessagingWindow(conversationId, whatsappAccountId, { transaction, now });
    if (messagingWindow.isOpen) return { allowed: true, messagingWindow, template: null };
    if (!templateId) {
      const code = messagingWindow.reason === 'NO_INBOUND_CUSTOMER_MESSAGE' ? 'NO_INBOUND_CUSTOMER_MESSAGE' : 'MESSAGING_WINDOW_CLOSED';
      throw Object.assign(new Error('The WhatsApp 24-hour messaging window is closed. An approved template is required.'), { status: 409, code, messagingWindow });
    }
    const template = await WhatsAppTemplate.findByPk(templateId, { transaction });
    if (!template || template.status !== 'APPROVED' || String(template.whatsappAccountId) !== String(whatsappAccountId)) {
      throw Object.assign(new Error('An approved template for this WhatsApp account is required.'), { status: 422, code: 'APPROVED_TEMPLATE_REQUIRED', messagingWindow });
    }
    return { allowed: true, messagingWindow, template };
  }
}

module.exports = new MessagingWindowService();
module.exports.calculateMessagingWindow = calculateMessagingWindow;
module.exports.calculateFreeEntryWindow = calculateFreeEntryWindow;
module.exports.WINDOW_MS = WINDOW_MS;
module.exports.FREE_ENTRY_WINDOW_MS = FREE_ENTRY_WINDOW_MS;
module.exports.QUALIFYING_RESPONSE_DEADLINE_MS = QUALIFYING_RESPONSE_DEADLINE_MS;
