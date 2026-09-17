const axios = require('axios');
const { Sequelize } = require('sequelize');
const { sequelize, Conversation, Message, FacebookContact, FacebookPage, User, Contact } = require('../models');
const facebookPageService = require('./facebookPage.service');
const facebookPageAccessService = require('./facebookPageAccess.service');
const facebookSettingsService = require('./facebookSettings.service');
const facebookConversationIdentityService = require('./facebookConversationIdentity.service');
const inboundFacebookMessageService = require('./inboundFacebookMessage.service');
const leadService = require('./lead.service');
const socketService = require('./socket.service');
const logger = require('../config/logger');
const { buildInboundSocketPayload } = require('./inboundFacebookMessage.service');
const { normalizeMessagePresentation } = require('./messagePresentation.service');

const ATTACHMENT_TYPE_MAP = { image: 'image', video: 'video', audio: 'audio', file: 'document' };

function messageCursor(row) {
  return Buffer.from(`${new Date(row.createdAt).getTime()}:${row.id}`).toString('base64');
}

function parseMessageCursor(value) {
  if (!value) return null;
  try {
    const [t, id] = Buffer.from(value, 'base64').toString('utf8').split(':');
    return { t: new Date(Number(t)), id: Number(id) };
  } catch (error) {
    return null;
  }
}

const GRAPH_API_BASE_URL = 'https://graph.facebook.com';

class FacebookMessengerService {
  async requestClient() {
    const { graphApiVersion } = await facebookSettingsService.getRuntimeConfig();
    return {
      client: axios.create({
        baseURL: `${GRAPH_API_BASE_URL}/${graphApiVersion}`,
        timeout: 20000
      })
    };
  }

  async retryRequest(callback, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await callback();
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        const retriable = status === undefined || [429, 500, 502, 503, 504].includes(status);
        if (!retriable || attempt === attempts) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
    throw lastError;
  }

  async findByClientMessageId(conversationId, clientMessageId) {
    if (!clientMessageId) return null;
    return Message.findOne({
      where: {
        conversationId,
        [Sequelize.Op.and]: Sequelize.where(
          Sequelize.json('raw_payload.clientMessageId'),
          clientMessageId
        )
      }
    }).catch(() => null);
  }

  async logMessage(payload) {
    if (payload.facebookMessageId) {
      const existing = await Message.findOne({ where: { facebookMessageId: payload.facebookMessageId } });
      if (existing) return existing.update(payload);
    }
    return Message.create(payload);
  }

  async sendTextMessage({ conversationId, text, userId = null, clientMessageId = null }) {
    if (!text || !String(text).trim()) throw Object.assign(new Error('Message text is required'), { status: 400 });

    const duplicate = await this.findByClientMessageId(conversationId, clientMessageId);
    if (duplicate) return duplicate;

    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) throw Object.assign(new Error('Conversation not found'), { status: 404 });
    if (!conversation.facebookPageId) {
      throw Object.assign(new Error('Conversation is not a Facebook conversation'), { status: 422, code: 'FACEBOOK_CONVERSATION_REQUIRED' });
    }

    const config = await facebookPageService.runtimeConfig(conversation.facebookPageId, userId);
    if (!config.sendEnabled) {
      throw Object.assign(new Error('Sending is disabled for this Facebook Page'), { status: 409, code: 'FACEBOOK_SEND_DISABLED' });
    }

    const facebookContact = await FacebookContact.findOne({
      where: { facebookPageId: conversation.facebookPageId, contactId: conversation.contactId }
    });
    if (!facebookContact) {
      throw Object.assign(new Error('Facebook recipient could not be resolved for this conversation'), { status: 422, code: 'FACEBOOK_RECIPIENT_NOT_FOUND' });
    }

    const payload = {
      recipient: { id: facebookContact.facebookPsid },
      message: { text },
      messaging_type: 'RESPONSE'
    };

    logger.info('facebook_messenger_send_attempt', { facebookPageId: conversation.facebookPageId, conversationId });

    const { client } = await this.requestClient();
    let response;
    try {
      response = await this.retryRequest(() => client.post(`/${config.pageId}/messages`, payload, {
        params: { access_token: config.pageAccessToken }
      }));
    } catch (error) {
      logger.error('facebook_messenger_send_failed', {
        facebookPageId: conversation.facebookPageId,
        conversationId,
        message: error.response?.data?.error?.message || error.message
      });
      throw Object.assign(new Error(error.response?.data?.error?.message || 'Failed to send Facebook message'), {
        status: 502, code: 'FACEBOOK_SEND_FAILED', exposeMessage: true
      });
    }

    const facebookMessageId = response.data?.message_id || null;
    const messageRecord = await this.logMessage({
      facebookMessageId,
      channel: 'facebook_messenger',
      conversationId: conversation.id,
      contactId: conversation.contactId,
      facebookPageId: conversation.facebookPageId,
      sentByUserId: userId || null,
      direction: 'outbound',
      type: 'text',
      text,
      status: 'sent',
      statusUpdatedAt: new Date(),
      rawPayload: clientMessageId ? { clientMessageId } : null
    });

    await conversation.update({ lastMessage: text, lastMessageAt: new Date() });

    logger.info('facebook_messenger_send_success', { facebookPageId: conversation.facebookPageId, conversationId, facebookMessageId });

    const socketPayload = buildInboundSocketPayload(messageRecord, { conversationId: conversation.id });
    socketService.emitToRoom(`conversation_${conversation.id}`, 'facebook.message.received', socketPayload);
    await socketService.emitToConversationAudience(conversation.id, 'facebook.conversation.updated', {
      conversationId: conversation.id, lastMessage: text, lastMessageAt: conversation.lastMessageAt
    });

    return messageRecord;
  }

  // Structured for future support — image/video/audio/file all funnel through
  // Messenger's attachment message format once media hosting is wired up.
  async sendMediaMessage() {
    throw Object.assign(new Error('Facebook Messenger media sending is not yet supported'), {
      status: 501, code: 'FACEBOOK_MEDIA_SEND_NOT_IMPLEMENTED'
    });
  }

  async listConversations({ facebookPageId = null, userId = null } = {}) {
    const accessWhere = userId ? await facebookPageAccessService.whereForUser(userId, 'facebookPageId') : {};
    const conversations = await Conversation.findAll({
      where: { channel: 'facebook_messenger', ...(facebookPageId ? { facebookPageId } : {}), ...accessWhere },
      include: [
        { model: Contact, as: 'contact', attributes: ['id', 'firstName', 'lastName', 'email'], required: false },
        { model: FacebookPage, as: 'facebookPage', attributes: ['id', 'name', 'pageId'], required: false },
        { model: User, as: 'assignedUser', attributes: ['id', 'firstName', 'lastName'], required: false }
      ],
      order: [['last_message_at', 'DESC']]
    });
    return conversations;
  }

  async getMessages(conversationId, userId = null, query = {}) {
    const conversation = await Conversation.findByPk(conversationId);
    if (!conversation) throw Object.assign(new Error('Conversation not found'), { status: 404 });
    if (conversation.channel !== 'facebook_messenger') {
      throw Object.assign(new Error('Conversation is not a Facebook conversation'), { status: 422, code: 'FACEBOOK_CONVERSATION_REQUIRED' });
    }
    if (userId) await facebookPageAccessService.assertAccess(conversation.facebookPageId, userId);

    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50));
    const cursor = parseMessageCursor(query.cursor);
    const where = { conversationId };
    if (cursor) where[Sequelize.Op.or] = [{ createdAt: { [Sequelize.Op.lt]: cursor.t } }, { createdAt: cursor.t, id: { [Sequelize.Op.lt]: cursor.id } }];

    const messages = await Message.findAll({
      where,
      include: [{ model: User, as: 'sentBy', attributes: ['id', 'firstName', 'lastName', 'email'], required: false }],
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit: limit + 1
    });
    const hasMore = messages.length > limit;
    if (hasMore) messages.length = limit;
    const nextCursor = hasMore && messages.length ? messageCursor(messages[messages.length - 1]) : null;
    return { items: messages.reverse().map(normalizeMessagePresentation), nextCursor, hasMore };
  }

  // Full inbound pipeline for one Messenger `messaging` webhook item: resolve
  // page/contact/lead/conversation, persist the message idempotently, emit
  // live updates. Returns null for events this MVP intentionally ignores
  // (echoes of our own sends, postbacks/read receipts with no message body).
  async handleInboundMessagingEvent(page, item) {
    const psid = item?.sender?.id;
    const message = item?.message;
    if (!psid || !message || message.is_echo) return null;
    const mid = message.mid;
    if (!mid) return null;

    let text = message.text || null;
    let type = 'text';
    let mediaUrl = null;
    if (Array.isArray(message.attachments) && message.attachments.length) {
      const attachment = message.attachments[0];
      type = ATTACHMENT_TYPE_MAP[attachment.type] || 'document';
      mediaUrl = attachment.payload?.url || null;
    }

    const timestamp = item.timestamp ? new Date(Number(item.timestamp)) : new Date();

    const resolved = await facebookConversationIdentityService.findOrCreateByPageAndPsid({
      facebookPageId: page.id,
      psid,
      displayName: null,
      lastMessageAt: timestamp,
      afterResolve: async ({ contact, conversation, transaction }) => {
        logger.info('facebook_contact_resolved', { facebookPageId: page.id, contactId: contact.id });

        let leadId = conversation.leadId;
        if (!leadId) {
          let lead = await leadService.getOpenLeadForContactAndFacebookPage(contact.id, page.id, transaction);
          if (!lead) lead = await leadService.createLead(contact.id, { source: 'Facebook', facebookPageId: page.id, transaction });
          leadId = lead.id;
          await conversation.update({ leadId }, { transaction });
        }

        return inboundFacebookMessageService.persist({
          contact,
          conversation,
          facebookPageId: page.id,
          facebookMessageId: mid,
          values: {
            direction: 'inbound',
            type,
            text,
            mediaUrl,
            status: 'delivered',
            createdAt: timestamp
          },
          transaction
        });
      }
    });

    const { messageRecord, created } = resolved.persisted || {};
    if (!messageRecord) return null;

    if (created) {
      await resolved.conversation.update({ lastMessage: text || `[${type}]`, lastMessageAt: timestamp });
      logger.info('facebook_message_created', { facebookPageId: page.id, conversationId: resolved.conversation.id, messageId: messageRecord.id });

      const socketPayload = buildInboundSocketPayload(messageRecord, { conversationId: resolved.conversation.id });
      socketService.emitToRoom(`conversation_${resolved.conversation.id}`, 'facebook.message.received', socketPayload);
      await socketService.emitToConversationAudience(resolved.conversation.id, 'facebook.conversation.updated', {
        conversationId: resolved.conversation.id, lastMessage: text || `[${type}]`, lastMessageAt: timestamp
      });

      // Fire-and-forget Flow Builder trigger matching (new-run starts only —
      // see flow.service.js comments on the current waiting-run-resume limitation).
      setImmediate(() => require('./flow.service').handleDomainEvent({
        eventType: 'facebook_message_received',
        eventId: mid,
        channel: 'facebook_messenger',
        facebookPageId: page.id,
        conversationId: resolved.conversation.id,
        contactId: resolved.contact.id,
        text,
        mediaUrl
      }).catch((error) => logger.warn('facebook_message_flow_dispatch_failed', { facebookPageId: page.id, message: error.message })));
    }

    return { messageRecord, conversation: resolved.conversation, created };
  }
}

module.exports = new FacebookMessengerService();
