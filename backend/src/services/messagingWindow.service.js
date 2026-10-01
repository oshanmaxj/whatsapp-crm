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

// A "qualifying business response" must have actually reached Meta — a
// message still 'pending' in our own queue (not yet confirmed sent) or
// 'failed' never left this system, so it can't be what opened a real
// Free Entry Point conversation on Meta's side. Mirrors the exact same
// "successfully sent" cumulative-funnel definition
// whatsappCompliance.service.js's windowDashboard() uses for its message
// counts, so the two can never disagree about what counts as sent.
const SUCCESSFULLY_SENT_STATUSES = ['sent', 'delivered', 'read'];

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
  // inbound messages.
  //
  // Considers EVERY referral-bearing inbound message still within the only
  // span during which any of them could possibly matter (a window lasts at
  // most 72h, and only opens for a response within 24h of its own referral
  // — so anything older than 96h total is guaranteed resolved or expired),
  // not just the latest one. A customer clicking a second ad while an
  // earlier referral's window is already open and active must never hide
  // that still-active window just because its own referral event is older
  // — the result always prefers any candidate that is currently 'active'
  // over a newer candidate that is merely 'pending_response'. Only when no
  // candidate is active does it fall back to the single most recent
  // referral's own status, which is what matters going forward once every
  // older one is resolved. "Qualifying response" for each candidate is the
  // first SUCCESSFULLY SENT outbound message after it, matching the "reply
  // within 24h" rule exactly — never a later message, and never one that
  // was only queued or failed.
  async getFreeEntryWindow(conversationId, whatsappAccountId, { transaction = null, now = new Date() } = {}) {
    if (!conversationId || !whatsappAccountId) throw Object.assign(new Error('Conversation and WhatsApp account are required.'), { status: 422, code: 'WHATSAPP_ACCOUNT_MISMATCH' });
    const conversation = await Conversation.findByPk(conversationId, { attributes: ['id', 'whatsappAccountId'], transaction });
    if (!conversation) throw Object.assign(new Error('Conversation not found.'), { status: 404, code: 'CONVERSATION_NOT_FOUND' });
    if (String(conversation.whatsappAccountId) !== String(whatsappAccountId)) throw Object.assign(new Error('Conversation belongs to a different WhatsApp account.'), { status: 409, code: 'WHATSAPP_ACCOUNT_MISMATCH' });
    const relevantSince = new Date(new Date(now).getTime() - (FREE_ENTRY_WINDOW_MS + QUALIFYING_RESPONSE_DEADLINE_MS));
    const referrals = await Message.findAll({
      where: {
        conversationId, whatsappAccountId, direction: 'inbound', createdAt: { [Op.gte]: relevantSince },
        [Op.or]: [{ referralSourceType: { [Op.ne]: null } }, { ctwaClid: { [Op.ne]: null } }]
      },
      attributes: ['createdAt'], order: [['created_at', 'DESC']], transaction
    });
    if (!referrals.length) return calculateFreeEntryWindow({ now });

    const candidates = await Promise.all(referrals.map(async (referral) => {
      const response = await Message.findOne({
        where: {
          conversationId, whatsappAccountId, direction: 'outbound', createdAt: { [Op.gt]: referral.createdAt },
          status: { [Op.in]: SUCCESSFULLY_SENT_STATUSES }
        },
        attributes: ['createdAt'], order: [['created_at', 'ASC']], transaction
      });
      return calculateFreeEntryWindow({ referralAt: referral.createdAt, responseAt: response?.createdAt || null, now });
    }));
    return candidates.find((candidate) => candidate.status === 'active') || candidates[0];
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
module.exports.SUCCESSFULLY_SENT_STATUSES = SUCCESSFULLY_SENT_STATUSES;
