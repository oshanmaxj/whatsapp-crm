const { Contact, Conversation, Message, PaymentSlip, User, sequelize } = require('../models');
const whatsappService = require('./whatsapp.service');
const whatsappComplianceService = require('./whatsappCompliance.service');
const whatsappTemplateService = require('./whatsappTemplate.service');
const conversationAccessService = require('./conversationAccess.service');
const { normalizePhone: normalizeWhatsAppNumber } = require('../utils/phone');
const { Op } = require('sequelize');
const interactiveMediaService = require('./interactiveMedia.service');
const { normalizeMessagePresentation } = require('./messagePresentation.service');

function previewText(message) {
  if (!message) return null;
  if (message.text) return message.text;
  if (message.templateName) return message.templateName;
  if (message.type === 'document') {
    return `Document: ${message.rawPayload?.file?.fileName || message.rawPayload?.document?.filename || message.rawPayload?.filename || 'Document'}`;
  }
  if (['image', 'video', 'audio'].includes(message.type)) {
    return message.type.charAt(0).toUpperCase() + message.type.slice(1);
  }
  return message.type || 'Message';
}

function senderLabel(message) {
  if (!message) return 'Previous message';
  return message.direction === 'outbound' ? 'You' : 'Customer';
}

function templateSendError(meta = {}, fallback = 'Template delivery failed.') {
  const code = String(meta?.code || '');
  if (code === '131048') return 'Meta temporarily blocked this marketing template delivery because of recipient engagement or messaging quality limits. Try another approved template, wait before retrying, or contact the customer only after they message again.';
  return String(meta?.error_user_msg || meta?.message || fallback).slice(0, 500);
}

function validateTemplateComponents(template, components) {
  const rows = Array.isArray(components) ? components : [];
  const bodyCount = Math.max(0, ...Array.from(String(template.body || '').matchAll(/{{\s*(\d+)\s*}}/g), (match) => Number(match[1])));
  const body = rows.find((item) => String(item.type || '').toLowerCase() === 'body');
  const supplied = Array.isArray(body?.parameters) ? body.parameters.length : 0;
  if (supplied !== bodyCount) throw Object.assign(new Error(`Template requires ${bodyCount} body parameter(s); ${supplied} supplied.`), { status: 422, code: 'TEMPLATE_PARAMETER_COUNT_INVALID' });
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(template.headerType).toUpperCase())) {
    const header = rows.find((item) => String(item.type || '').toLowerCase() === 'header');
    if (!header?.parameters?.[0]) throw Object.assign(new Error(`${template.headerType} template header media is required.`), { status: 422, code: 'TEMPLATE_HEADER_MEDIA_REQUIRED' });
  }
  return rows;
}

function serializeSentBy(user) {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || 'Agent';
  return { id: user.id, name, email: user.email || null };
}

function serializeMessage(message) {
  const json = normalizeMessagePresentation(message);
  if (!json) return json;
  const reply = json.replyToMessage || null;
  const replyPreview = reply
    ? {
        id: reply.id,
        whatsappMessageId: reply.whatsappMessageId,
        sender: senderLabel(reply),
        direction: reply.direction,
        type: reply.type,
        text: previewText(reply)
      }
    : json.replyToWhatsappMessageId
      ? {
          id: null,
          whatsappMessageId: json.replyToWhatsappMessageId,
          sender: 'Previous message',
          type: 'unknown',
          text: 'Replied to a previous message'
        }
      : null;
  return { ...json, sentBy: serializeSentBy(json.sentBy), replyPreview };
}

class ChatService {
  async canonicalConversation(conversationId, include = []) {
    const requested = await Conversation.findByPk(conversationId, { include });
    if (!requested?.normalizedPhone) return requested;
    return (await Conversation.findOne({
      where: { normalizedPhone: requested.normalizedPhone, whatsappAccountId: requested.whatsappAccountId },
      include,
      order: [
        [require('../models').sequelize.literal("CASE WHEN \"Conversation\".\"status\" = 'open' THEN 0 WHEN \"Conversation\".\"status\" = 'pending' THEN 1 ELSE 2 END"), 'ASC'],
        ['created_at', 'ASC']
      ]
    })) || requested;
  }

  async resolveReplyContext(conversationId, replyToMessageId) {
    if (!replyToMessageId) return { replyToMessageId: null, replyToWhatsappMessageId: null };
    const original = await Message.findOne({
      where: { id: replyToMessageId, conversationId },
      attributes: ['id', 'whatsappMessageId']
    });
    if (!original) {
      const error = new Error('Reply target message not found');
      error.status = 404;
      throw error;
    }
    if (!original.whatsappMessageId) {
      const error = new Error('Reply target does not have a WhatsApp message id yet');
      error.status = 409;
      throw error;
    }
    return {
      replyToMessageId: original.id,
      replyToWhatsappMessageId: original.whatsappMessageId
    };
  }

  async sendChatMessage({ conversationId, senderId, text, replyToMessageId = null }) {
    await conversationAccessService.assertConversationAccess(conversationId, senderId);
    const conversation = await this.canonicalConversation(conversationId, [
      { model: Contact, as: 'contact', attributes: ['id', 'phone', 'whatsappId'] }
    ]);
    if (!conversation) {
      const error = new Error('Conversation not found');
      error.status = 404;
      throw error;
    }

    const toNumber = normalizeWhatsAppNumber(
      conversation.contact?.whatsappId || conversation.contact?.phone
    );
    if (!toNumber) {
      const error = new Error('Conversation contact does not have a phone number');
      error.status = 400;
      throw error;
    }

    const compliance = await whatsappComplianceService.canSendFreeFormMessage(conversation.contactId, conversation.whatsappAccountId);
    if (!compliance.canSend) {
      const error = new Error('Template required to message this customer.');
      error.status = 409;
      error.code = 'TEMPLATE_REQUIRED';
      error.lastInboundAt = compliance.lastInboundAt;
      throw error;
    }

    const runtimeConfig = await whatsappService.getRuntimeConfig(conversation.whatsappAccountId);
    conversationId = conversation.id;
    const replyContext = await this.resolveReplyContext(conversationId, replyToMessageId);
    const message = await Message.create({
      conversationId,
      contactId: conversation.contactId,
      sentByUserId: senderId,
      direction: 'outbound',
      type: 'text',
      whatsappMessageId: null,
      text,
      fromNumber: runtimeConfig.phoneNumberId || null,
      toNumber,
      status: 'pending',
      replyToMessageId: replyContext.replyToMessageId,
      replyToWhatsappMessageId: replyContext.replyToWhatsappMessageId,
      statusUpdatedAt: new Date(),
      isRead: true,
      rawPayload: {}
      , whatsappAccountId: conversation.whatsappAccountId || null
    });

    try {
      const whatsappResponse = await whatsappService.sendTextMessage({
        to: toNumber,
        text,
        contextMessageId: replyContext.replyToWhatsappMessageId,
        log: false,
        whatsappAccountId: conversation.whatsappAccountId
      });
      await message.update({
        whatsappMessageId: whatsappResponse?.id || null,
        status: 'sent',
        statusUpdatedAt: new Date(),
        rawPayload: { whatsapp: whatsappResponse }
      });
      await conversation.update({ lastMessageAt: new Date() });
      await require('./aiAgent.service').pauseForHumanReply(conversation.id,senderId).catch(()=>null);
      return this.getMessageWithReplyPreview(message.id);
    } catch (error) {
      const metaError = error.metaError || error.response?.data || {};
      const whatsappError = metaError.error || metaError;
      await message.update({
        status: 'failed',
        statusUpdatedAt: new Date(),
        errorCode: whatsappError?.code == null ? null : String(whatsappError.code),
        errorSubcode: whatsappError?.error_subcode == null ? null : String(whatsappError.error_subcode),
        errorMessage: whatsappError?.error_user_msg || whatsappError?.message || error.message,
        rawPayload: { whatsappError: metaError }
      }).catch(() => {});
      error.messageRecord = await this.getMessageWithReplyPreview(message.id);
      throw error;
    }
  }

  async sendChatInteractive({ conversationId, senderId, body, footer = null, header = null, buttons = [], clientRequestId = null }) {
    await conversationAccessService.assertConversationAccess(conversationId, senderId);
    const conversation = await this.canonicalConversation(conversationId, [
      { model: Contact, as: 'contact', attributes: ['id', 'phone', 'whatsappId'] }
    ]);
    if (!conversation?.whatsappAccountId) throw Object.assign(new Error('Canonical conversation does not have a WhatsApp account.'), { status: 422, code: 'WHATSAPP_ACCOUNT_REQUIRED' });
    const toNumber = normalizeWhatsAppNumber(conversation.contact?.whatsappId || conversation.contact?.phone);
    if (!toNumber) throw Object.assign(new Error('Conversation contact does not have a phone number'), { status: 400 });
    const messageBody = String(body || '').trim();
    if (!messageBody) throw Object.assign(new Error('Interactive message body is required.'), { status: 422, code: 'INTERACTIVE_BODY_REQUIRED' });
    if (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > 3) throw Object.assign(new Error('Interactive reply messages require 1 to 3 buttons.'), { status: 422, code: 'INTERACTIVE_BUTTONS_INVALID' });
    const normalizedButtons = buttons.map((button, index) => ({
      id: String(button.id || `button_${index + 1}`).slice(0, 160),
      title: String(button.title || '').trim().slice(0, 20)
    }));
    if (normalizedButtons.some((button) => !button.title)) throw Object.assign(new Error('Every interactive button requires a title.'), { status: 422, code: 'INTERACTIVE_BUTTONS_INVALID' });
    const compliance = await whatsappComplianceService.canSendFreeFormMessage(conversation.contactId, conversation.whatsappAccountId);
    if (!compliance.canSend) throw Object.assign(new Error('Template required to message this customer.'), { status: 409, code: 'TEMPLATE_REQUIRED' });

    let existing = null;
    if (clientRequestId) {
      existing = await Message.findOne({ where: {
        conversationId: conversation.id,
        direction: 'outbound',
        [Op.and]: sequelize.where(sequelize.json('raw_payload.clientRequestId'), String(clientRequestId).slice(0, 100))
      } }).catch(() => null);
      if (existing?.status === 'sent' && existing.whatsappMessageId) return this.getMessageWithReplyPreview(existing.id);
    }
    let requestedHeader = header;
    if (header?.dataBase64) {
      const binding = await interactiveMediaService.storeAndUpload({
        scope: 'conversation', scopeId: conversation.id,
        dataBase64: header.dataBase64, fileName: header.fileName,
        mimeType: header.mimeType, mediaType: header.type,
        whatsappAccountId: conversation.whatsappAccountId
      });
      requestedHeader = { type: binding.mediaType, ...binding };
    } else if (!requestedHeader && existing?.rawPayload?.mediaBinding) {
      requestedHeader = { type: existing.rawPayload.mediaBinding.mediaType, ...existing.rawPayload.mediaBinding };
    }
    const resolved = await interactiveMediaService.resolveHeader(requestedHeader, { whatsappAccountId: conversation.whatsappAccountId, interactiveType: 'button' });
    const runtimeConfig = await whatsappService.getRuntimeConfig(conversation.whatsappAccountId);
    const canonicalInteractive = {
      kind: 'button', body: messageBody, footer: footer || null,
      header: resolved.header?.type === 'text' ? { type: 'text', text: resolved.header.text }
        : resolved.header ? { type: resolved.header.type, mediaUrl: resolved.binding?.url || null, mimeType: resolved.binding?.mimeType || null, filename: resolved.header.type === 'document' ? resolved.binding?.fileName || null : null, whatsappMediaId: resolved.binding?.mediaId || null, localMediaRef: resolved.binding?.localMediaRef || null } : null,
      buttons: normalizedButtons.map((button, index) => ({ ...button, order: index, actionType: 'reply' }))
    };
    const values = {
      conversationId: conversation.id, contactId: conversation.contactId, sentByUserId: senderId,
      direction: 'outbound', type: 'text', messageType: 'interactive', interactiveType: 'button',
      text: messageBody, fromNumber: runtimeConfig.phoneNumberId || null, toNumber,
      status: 'pending', statusUpdatedAt: new Date(), isRead: true,
      whatsappAccountId: conversation.whatsappAccountId,
      rawPayload: {
        clientRequestId: clientRequestId ? String(clientRequestId).slice(0, 100) : null,
        headerType: resolved.header?.type || 'none', mediaBinding: resolved.binding || null,
        buttons: normalizedButtons,
        interactive: canonicalInteractive
      }
    };
    const message = existing || await Message.create(values);
    if (existing) await existing.update({ ...values, whatsappMessageId: null, errorCode: null, errorSubcode: null, errorMessage: null });
    try {
      const response = await whatsappService.sendInteractiveMessage({
        to: toNumber, body: messageBody, footer, header: resolved.header,
        buttons: normalizedButtons, log: false, whatsappAccountId: conversation.whatsappAccountId
      });
      if (!response?.id) throw Object.assign(new Error('Meta did not return a WhatsApp message ID.'), { status: 502, code: 'WHATSAPP_MESSAGE_ID_MISSING' });
      await message.update({ whatsappMessageId: response.id, status: 'sent', statusUpdatedAt: new Date(), rawPayload: { ...(message.rawPayload || values.rawPayload), whatsappMessageId: response.id } });
      await conversation.update({ lastMessage: messageBody, lastMessageAt: new Date() });
      await require('./aiAgent.service').pauseForHumanReply(conversation.id,senderId).catch(()=>null);
      return this.getMessageWithReplyPreview(message.id);
    } catch (error) {
      const meta = error.whatsappApiResponse?.error || error.response?.data?.error || error.metaError?.error || {};
      await message.update({
        status: 'failed', statusUpdatedAt: new Date(),
        errorCode: meta.code == null ? (error.code || null) : String(meta.code),
        errorSubcode: meta.error_subcode == null ? null : String(meta.error_subcode),
        errorMessage: String(meta.error_user_msg || meta.message || error.message).slice(0, 500),
        rawPayload: { ...values.rawPayload, deliveryError: { code: meta.code || error.code || null, subcode: meta.error_subcode || null, type: meta.type || null, message: String(meta.error_user_msg || meta.message || error.message).slice(0, 500) } }
      }).catch(() => null);
      error.messageRecord = await this.getMessageWithReplyPreview(message.id);
      throw error;
    }
  }

  async sendChatTemplate({
    conversationId,
    senderId,
    templateName,
    languageCode,
    components = [],
    replyToMessageId = null
  }) {
    await conversationAccessService.assertConversationAccess(conversationId, senderId);
    const conversation = await this.canonicalConversation(conversationId, [
      { model: Contact, as: 'contact', attributes: ['id', 'phone', 'whatsappId'] }
    ]);
    if (!conversation) throw Object.assign(new Error('Conversation not found'), { status: 404 });

    const toNumber = normalizeWhatsAppNumber(
      conversation.contact?.whatsappId || conversation.contact?.phone
    );
    if (!toNumber) {
      throw Object.assign(new Error('Conversation contact does not have a phone number'), { status: 400 });
    }

    const template = await whatsappTemplateService.approvedTemplateByName(
      templateName,
      languageCode,
      conversation.whatsappAccountId
    );
    if (!template) {
      const error = new Error('Approved WhatsApp template not found');
      error.status = 400;
      error.code = 'TEMPLATE_NOT_APPROVED';
      throw error;
    }
    components = validateTemplateComponents(template, components);

    conversationId = conversation.id;
    const runtimeConfig = await whatsappService.getRuntimeConfig(conversation.whatsappAccountId);
    const replyContext = await this.resolveReplyContext(conversationId, replyToMessageId);
    const message = await Message.create({
      conversationId,
      contactId: conversation.contactId,
      sentByUserId: senderId,
      direction: 'outbound',
      type: 'template',
      templateName: template.name,
      text: template.body,
      fromNumber: runtimeConfig.phoneNumberId || null,
      toNumber,
      status: 'pending',
      replyToMessageId: replyContext.replyToMessageId,
      replyToWhatsappMessageId: replyContext.replyToWhatsappMessageId,
      statusUpdatedAt: new Date(),
      isRead: true,
      rawPayload: { template: { name: template.name, language: template.language, components } }
      , whatsappAccountId: conversation.whatsappAccountId || null
    });

    try {
      const whatsappResponse = await whatsappService.sendTemplateMessage({
        to: toNumber,
        templateName: template.name,
        language: template.language,
        components,
        contextMessageId: replyContext.replyToWhatsappMessageId,
        log: false,
        whatsappAccountId: conversation.whatsappAccountId
      });
      await message.update({
        whatsappMessageId: whatsappResponse?.id || null,
        status: 'sent',
        statusUpdatedAt: new Date(),
        rawPayload: {
          template: { name: template.name, language: template.language, components },
          whatsapp: whatsappResponse
        }
      });
      await conversation.update({ lastMessageAt: new Date() });
      await require('./aiAgent.service').pauseForHumanReply(conversation.id,senderId).catch(()=>null);
      return this.getMessageWithReplyPreview(message.id);
    } catch (error) {
      const metaError = error.metaError || error.response?.data || error.whatsappApiResponse || {};
      const whatsappError = metaError.error || metaError;
      const safeMessage = templateSendError(whatsappError, error.message);
      await message.update({
        status: 'failed',
        statusUpdatedAt: new Date(),
        errorCode: whatsappError?.code == null ? null : String(whatsappError.code),
        errorSubcode: whatsappError?.error_subcode == null ? null : String(whatsappError.error_subcode),
        errorMessage: safeMessage,
        rawPayload: { template: { name: template.name, language: template.language, category: template.category, components }, selectedWhatsappAccountId: conversation.whatsappAccountId, failedAt: new Date().toISOString(), nonRetryable: String(whatsappError?.code || '') === '131048', whatsappError: { code: whatsappError?.code || null, error_subcode: whatsappError?.error_subcode || null, message: safeMessage } }
      }).catch(() => {});
      error.message = safeMessage;
      error.code = String(whatsappError?.code || error.code || 'TEMPLATE_SEND_FAILED');
      error.status = error.status || 422;
      error.messageRecord = await this.getMessageWithReplyPreview(message.id);
      throw error;
    }
  }

  async getTemplateDiagnostics(conversationId, userId, templateName, languageCode) {
    await conversationAccessService.assertConversationAccess(conversationId, userId);
    const conversation = await this.canonicalConversation(conversationId, []);
    if (!conversation?.whatsappAccountId) throw Object.assign(new Error('Canonical conversation does not have a WhatsApp account.'), { status: 422, code: 'WHATSAPP_ACCOUNT_REQUIRED' });
    const template = await whatsappTemplateService.approvedTemplateByName(templateName, languageCode, conversation.whatsappAccountId);
    const account = await require('../models').WhatsAppAccount.findByPk(conversation.whatsappAccountId, { attributes: ['id', 'name', 'phoneNumberId', 'wabaId'] });
    const compliance = await require('./whatsappCompliance.service').canSendFreeFormMessage(conversation.contactId, conversation.whatsappAccountId);
    const lastFailure = await Message.findOne({ where: { conversationId: conversation.id, type: 'template', status: 'failed', ...(templateName ? { templateName } : {}) }, order: [['status_updated_at', 'DESC']], attributes: ['errorCode', 'errorSubcode', 'errorMessage', 'statusUpdatedAt'] });
    return { account, template: template ? { id: template.id, name: template.name, category: template.category, language: template.language, status: template.status, lastSync: template.lastSyncedAt } : null, lastSendError: lastFailure, windowOpen: compliance.canSend, messageRequirement: compliance.canSend ? 'normal_text_or_template' : 'template_required' };
  }

  async getMessageStatus(id, userId) {
    const message = await Message.findByPk(id, {
      attributes: ['id', 'conversationId', 'whatsappMessageId', 'status', 'statusUpdatedAt']
    });
    if (!message) {
      const error = new Error('Message not found');
      error.status = 404;
      throw error;
    }
    await conversationAccessService.assertConversationAccess(message.conversationId, userId);
    return message;
  }

  async getMessageWithReplyPreview(id) {
    const message = await Message.findByPk(id, {
      include: [
        {
          model: Message,
          as: 'replyToMessage',
          attributes: ['id', 'whatsappMessageId', 'direction', 'type', 'text', 'mediaUrl', 'templateName', 'rawPayload'],
          required: false
        },
        {
          model: User,
          as: 'sentBy',
          attributes: ['id', 'firstName', 'lastName', 'email'],
          required: false
        },
        {
          model: PaymentSlip,
          as: 'paymentSlip',
          attributes: ['id', 'verificationStatus', 'detectionConfidence'],
          required: false
        }
      ]
    });
    return serializeMessage(message);
  }

  async markConversationRead(conversationId, userId) {
    await conversationAccessService.assertConversationAccess(conversationId, userId);
    return Message.update(
      { isRead: true, readAt: new Date() },
      {
        where: {
          conversationId,
          direction: 'inbound',
          isRead: false
        }
      }
    );
  }

  async getConversationUnreadCount(conversationId, userId) {
    await conversationAccessService.assertConversationAccess(conversationId, userId);
    const unread = await Message.count({
      where: {
        conversationId,
        direction: 'inbound',
        isRead: false
      }
    });

    return unread;
  }

  async getUnreadCountsForUser(userId) {
    const where = await conversationAccessService.scopedWhere(userId, { status: { [Op.ne]: 'archived' } });
    const conversations = await Conversation.findAll({
      where,
      attributes: ['id']
    });

    let totalUnread = 0;
    for (const conversation of conversations) {
      const unread = await Message.count({
        where: {
          conversationId: conversation.id,
          direction: 'inbound',
          isRead: false
        }
      });
      totalUnread += unread;
    }

    return totalUnread;
  }

  async getConversationList(userId) {
    const where = await conversationAccessService.scopedWhere(userId, { status: { [Op.ne]: 'archived' } });
    return Conversation.findAll({
      where,
      order: [['updated_at', 'DESC']]
    });
  }

  async getConversationMessages(conversationId, userId) {
    await conversationAccessService.assertConversationAccess(conversationId, userId);
    const conversation = await Conversation.findByPk(conversationId, { attributes: ['id', 'normalizedPhone', 'whatsappAccountId'] });
    const conversationIds = conversation?.normalizedPhone
      ? (await Conversation.findAll({
          where: { normalizedPhone: conversation.normalizedPhone, whatsappAccountId: conversation.whatsappAccountId },
          attributes: ['id']
        })).map((item) => item.id)
      : [conversationId];
    const messages = await Message.findAll({
      where: { conversationId: { [require('sequelize').Op.in]: conversationIds } },
      include: [
        {
          model: Message,
          as: 'replyToMessage',
          attributes: ['id', 'whatsappMessageId', 'direction', 'type', 'text', 'mediaUrl', 'templateName', 'rawPayload'],
          required: false
        },
        {
          model: User,
          as: 'sentBy',
          attributes: ['id', 'firstName', 'lastName', 'email'],
          required: false
        },
        {
          model: PaymentSlip,
          as: 'paymentSlip',
          attributes: ['id', 'verificationStatus', 'detectionConfidence'],
          required: false
        }
      ],
      order: [['created_at', 'ASC']]
    });
    return messages.map(serializeMessage);
  }
}

module.exports = new ChatService();
module.exports.templateSendError = templateSendError;
module.exports.validateTemplateComponents = validateTemplateComponents;
