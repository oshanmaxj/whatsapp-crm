const { Op } = require('sequelize');
const models = require('../models');
const logger = require('../config/logger');
const socketService = require('./socket.service');
const canonicalConversationService = require('./canonicalWhatsappConversation.service');
const { normalizePhone, requireNormalizedPhone } = require('../utils/phone');

function createOutboundHistoryService(dependencies = {}) {
  const Contact = dependencies.Contact || models.Contact;
  const Message = dependencies.Message || models.Message;
  const canonical = dependencies.canonicalConversationService || canonicalConversationService;
  const sockets = dependencies.socketService || socketService;
  const log = dependencies.logger || logger;

  async function resolveContact({ contactId, phone, name }) {
    if (contactId) {
      const byId = await Contact.findByPk(contactId);
      if (byId) return byId;
    }
    const normalized = requireNormalizedPhone(phone);
    const candidates = await Contact.findAll({
      where: { [Op.or]: [
        { normalizedPhone: normalized }, { phone: normalized }, { whatsappId: normalized },
        { phone: { [Op.like]: `%${normalized.slice(-7)}` } },
        { whatsappId: { [Op.like]: `%${normalized.slice(-7)}` } }
      ] }, limit: 20
    });
    const existing = candidates.find((candidate) => normalizePhone(candidate.phone) === normalized || normalizePhone(candidate.whatsappId) === normalized);
    if (existing) return existing;
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    const [created] = await Contact.findOrCreate({ where: { phone: normalized }, defaults: {
      phone: normalized, whatsappId: normalized, firstName: parts.shift() || 'WhatsApp',
      lastName: parts.join(' ') || null, status: 'active', whatsappAccountId: null
    } });
    return created;
  }

  async function prepare(payload) {
    const contact = await resolveContact(payload);
    const conversation = await canonical.resolveCanonicalWhatsAppConversation({
      preferredConversationId: payload.conversationId,
      sourceMessageId: payload.sourceMessageId,
      paymentSlipId: payload.paymentSlipId,
      contactId: contact.id,
      whatsappAccountId: payload.whatsappAccountId
    });
    if (!conversation?.id || !conversation.whatsappAccountId) {
      throw Object.assign(new Error('Outbound WhatsApp history requires a canonical conversation and account.'), { code: 'WHATSAPP_CONVERSATION_REQUIRED' });
    }
    const now = new Date();
    const values = {
      whatsappMessageId: payload.whatsappMessageId || null,
      conversationId: conversation.id, contactId: contact.id,
      whatsappAccountId: conversation.whatsappAccountId,
      sentByUserId: payload.sentByUserId || null, direction: 'outbound', channel: 'whatsapp',
      type: payload.type || 'text', messageType: payload.messageType || payload.type || 'text',
      text: payload.text || null, mediaId: payload.mediaId || null, mediaUrl: payload.mediaUrl || null,
      interactiveType: payload.interactiveType || null, buttonPayload: payload.buttonPayload || null,
      templateName: payload.templateName || null, campaignId: payload.campaignId || null,
      campaignRecipientId: payload.campaignRecipientId || null,
      isInternalNotification: Boolean(payload.isInternalNotification), sentToUserId: payload.sentToUserId || null,
      sentToPhone: payload.sentToPhone || null, fromNumber: payload.fromNumber || null,
      toNumber: requireNormalizedPhone(payload.isInternalNotification ? payload.sentToPhone : payload.phone),
      status: payload.status || 'pending', statusUpdatedAt: now, isRead: true,
      rawPayload: payload.rawPayload || {}
    };
    let message = payload.historyMessageId ? await Message.findByPk(payload.historyMessageId) : null;
    if (!message && values.whatsappMessageId) message = await Message.findOne({ where: { whatsappMessageId: values.whatsappMessageId } });
    if (message) await message.update(values);
    else message = await Message.create(values);
    return { contact, conversation, message, payload };
  }

  async function emit(prepared) {
    const event = prepared.message.toJSON ? prepared.message.toJSON() : prepared.message;
    sockets.emitToRoom(`conversation_${prepared.conversation.id}`, 'chat:message', event);
    await sockets.emitToConversationAudience(prepared.conversation.id, 'chat:message', event);
  }

  async function complete(prepared, result = {}) {
    const now = new Date();
    await prepared.message.update({
      whatsappMessageId: result.whatsappMessageId || prepared.message.whatsappMessageId || null,
      status: result.status || 'sent', statusUpdatedAt: now,
      rawPayload: result.rawPayload || prepared.message.rawPayload || {}
    });
    await prepared.conversation.update({
      lastMessage: prepared.payload.text || prepared.payload.templateName || 'WhatsApp message',
      lastMessageAt: now, updatedAt: now
    });
    await emit(prepared);
    return prepared.message;
  }

  async function fail(prepared, error) {
    if (!prepared?.message) return;
    await prepared.message.update({ status: 'failed', statusUpdatedAt: new Date(), rawPayload: {
      ...(prepared.message.rawPayload || {}), deliveryError: String(error?.message || error).slice(0, 500)
    } });
    await emit(prepared);
  }

  return {
    resolveContact, prepare, complete, fail,
    async record(payload) {
      try {
        const prepared = await prepare(payload);
        return await complete(prepared, {
          whatsappMessageId: payload.whatsappMessageId,
          status: payload.status || 'sent', rawPayload: payload.rawPayload
        });
      } catch (error) {
        log.warn('outbound_chat_history_save_failed', {
          phoneLast4: normalizePhone(payload.phone).slice(-4), campaignId: payload.campaignId || null,
          conversationId: payload.conversationId || null, message: error.message
        });
        return null;
      }
    }
  };
}

module.exports = createOutboundHistoryService();
module.exports.createOutboundHistoryService = createOutboundHistoryService;
