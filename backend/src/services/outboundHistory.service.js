const { Op } = require('sequelize');
const models = require('../models');
const logger = require('../config/logger');
const socketService = require('./socket.service');
const canonicalConversationService = require('./canonicalWhatsappConversation.service');
const { normalizePhone, requireNormalizedPhone } = require('../utils/phone');
const { resolvePrivatePath, safeFilename } = require('./interactiveMedia.service');
const { normalizeMessagePresentation } = require('./messagePresentation.service');

function createOutboundHistoryService(dependencies = {}) {
  const Contact = dependencies.Contact || models.Contact;
  const Message = dependencies.Message || models.Message;
  const Media = dependencies.Media || models.Media;
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
    const rawPayload = {
      ...(payload.rawPayload || {}),
      ...(payload.media ? { media: payload.media } : {}),
      ...(payload.interactive ? { interactive: payload.interactive } : {})
    };
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
      rawPayload
    };
    let message = payload.historyMessageId ? await Message.findByPk(payload.historyMessageId) : null;
    if (!message && values.whatsappMessageId) message = await Message.findOne({ where: { whatsappMessageId: values.whatsappMessageId } });
    if (message?.rawPayload?.media?.crmMediaId && rawPayload.media) {
      rawPayload.media = {
        ...rawPayload.media,
        crmMediaId: message.rawPayload.media.crmMediaId,
        url: message.rawPayload.media.url || rawPayload.media.url || null
      };
      if (message.rawPayload.interactive?.header?.mediaUrl && rawPayload.interactive?.header) {
        rawPayload.interactive.header.mediaUrl = message.rawPayload.interactive.header.mediaUrl;
      }
      values.mediaUrl = message.mediaUrl || values.mediaUrl;
      values.rawPayload = rawPayload;
    }
    if (message) await message.update(values);
    else message = await Message.create(values);
    if (payload.media?.localMediaRef && !rawPayload.media?.crmMediaId) {
      const fileName = safeFilename(payload.media.originalFilename || payload.media.filename || payload.media.fileName, payload.media.type || 'media');
      const media = await Media.create({
        conversationId: conversation.id, messageId: message.id, uploadedBy: payload.sentByUserId || null,
        fileName, originalName: fileName, mimeType: payload.media.mimeType || 'application/octet-stream',
        mediaType: payload.media.type === 'document' ? 'document' : payload.media.type,
        size: Number(payload.media.size || 0), storagePath: resolvePrivatePath(payload.media.localMediaRef),
        publicUrl: null, caption: payload.media.caption || null
      });
      const crmUrl = `/api/media/${media.id}/download`;
      await media.update({ publicUrl: crmUrl });
      const nextRaw = {
        ...rawPayload,
        media: { ...rawPayload.media, crmMediaId: media.id, url: crmUrl },
        ...(rawPayload.interactive?.header ? { interactive: { ...rawPayload.interactive, header: { ...rawPayload.interactive.header, mediaUrl: crmUrl } } } : {})
      };
      await message.update({ mediaUrl: values.mediaUrl || crmUrl, rawPayload: nextRaw });
    }
    return { contact, conversation, message, payload };
  }

  async function emit(prepared) {
    const event = normalizeMessagePresentation(prepared.message);
    sockets.emitToRoom(`conversation_${prepared.conversation.id}`, 'chat:message', event);
    await sockets.emitToConversationAudience(prepared.conversation.id, 'chat:message', event);
  }

  async function complete(prepared, result = {}) {
    const now = new Date();
    await prepared.message.update({
      whatsappMessageId: result.whatsappMessageId || prepared.message.whatsappMessageId || null,
      status: result.status || 'sent', statusUpdatedAt: now,
      rawPayload: {
        ...(prepared.message.rawPayload || {}),
        ...(result.rawPayload || {})
      }
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
    const meta = error?.whatsappApiResponse?.error || error?.response?.data?.error || error?.metaError?.error || {};
    const errorMessage = String(meta.error_user_msg || meta.message || error?.message || error).slice(0, 500);
    const errorData = meta.error_data ? logger.redact(meta.error_data) : null;
    await prepared.message.update({
      status: 'failed', statusUpdatedAt: new Date(),
      errorCode: meta.code == null ? (error?.code || null) : String(meta.code),
      errorSubcode: meta.error_subcode == null ? null : String(meta.error_subcode),
      errorMessage,
      rawPayload: {
        ...(prepared.message.rawPayload || {}),
        deliveryError: {
          code: meta.code == null ? (error?.code || null) : String(meta.code),
          subcode: meta.error_subcode == null ? null : String(meta.error_subcode),
          type: meta.type || null,
          message: errorMessage,
          errorData,
          fbtraceId: meta.fbtrace_id || null
        }
      }
    });
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
