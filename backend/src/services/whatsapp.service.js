const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const { CampaignEvent, CampaignRecipient, FlowNode, Message, MessageQueue } = require('../models');
const whatsappConfig = require('../config/whatsapp');
const whatsappSettingsService = require('./whatsappSettings.service');
const whatsappAccountService = require('./whatsappAccount.service');
const leadManagementService = require('./leadManagement.service');
const contactService = require('./contact.service');
const conversationService = require('./conversation.service');
const aiService = require('./ai.service');
const autoReplyService = require('./autoReply.service');
const socketService = require('./socket.service');
const storageService = require('./storage.service');
const logger = require('../config/logger');

const MESSAGE_STATUSES = new Set(['pending', 'sent', 'delivered', 'read', 'failed']);
const STORED_MESSAGE_TYPES = new Set([
  'text', 'image', 'video', 'audio', 'document', 'location', 'sticker', 'reaction'
]);

function inboundPayloadSummary(message) {
  return {
    id: message?.id || null,
    from: message?.from || null,
    type: message?.type || null,
    timestamp: message?.timestamp || null,
    fields: message && typeof message === 'object' ? Object.keys(message) : []
  };
}

function parseInboundContent(message = {}) {
  const rawType = String(message.type || '').toLowerCase();

  if (rawType === 'button') {
    return {
      supported: true,
      rawType,
      storedType: 'text',
      messageType: 'button_reply',
      interactiveType: 'button',
      text: message.button?.text || message.button?.payload || null,
      buttonPayload: message.button?.payload || null
    };
  }

  if (rawType === 'interactive') {
    const interactiveType = message.interactive?.type || null;
    const reply = interactiveType === 'button_reply'
      ? message.interactive?.button_reply
      : interactiveType === 'list_reply'
        ? message.interactive?.list_reply
        : interactiveType === 'nfm_reply'
          ? message.interactive?.nfm_reply
        : null;
    if (!reply) {
      return { supported: false, rawType, interactiveType };
    }
    return {
      supported: true,
      rawType,
      storedType: 'text',
      messageType: 'interactive',
      interactiveType,
      text: reply.title || reply.id || (interactiveType === 'nfm_reply' ? 'WhatsApp Flow submitted' : null),
      buttonPayload: reply.id || reply.name || null
    };
  }

  if (!STORED_MESSAGE_TYPES.has(rawType)) {
    return { supported: false, rawType };
  }

  let text = message.text?.body || message[rawType]?.caption || null;
  if (rawType === 'reaction') text = message.reaction?.emoji || text;
  if (rawType === 'location' && !text) {
    const latitude = message.location?.latitude;
    const longitude = message.location?.longitude;
    text = latitude != null && longitude != null ? `${latitude}, ${longitude}` : null;
  }
  return {
    supported: true,
    rawType,
    storedType: rawType,
    messageType: rawType,
    interactiveType: null,
    text,
    buttonPayload: null
  };
}

function statusTimestamp(value) {
  const seconds = Number(value);
  const date = Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function statusError(status) {
  const error = Array.isArray(status?.errors) ? status.errors[0] : null;
  return {
    errorCode: error?.code == null ? null : String(error.code),
    errorMessage: error?.error_data?.details || error?.message || error?.title || null
  };
}

function messagePreviewText(message) {
  if (!message) return 'Message';
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

function trimCredential(value) {
  return value == null ? '' : String(value).trim();
}

function normalizeConfig(config = {}) {
  return {
    ...config,
    accessToken: trimCredential(config.accessToken),
    phoneNumberId: trimCredential(config.phoneNumberId),
    verifyToken: trimCredential(config.verifyToken),
    apiVersion: trimCredential(config.apiVersion) || 'v17.0',
    apiBaseUrl: trimCredential(config.apiBaseUrl) || 'https://graph.facebook.com'
  };
}

function safeApiError(error) {
  const metaError = error.response?.data?.error || null;
  return {
    message: error.message,
    status: error.response?.status || null,
    metaMessage: metaError?.message || null,
    metaType: metaError?.type || null,
    metaCode: metaError?.code || null,
    metaSubcode: metaError?.error_subcode || null,
    fbtraceId: metaError?.fbtrace_id || null
  };
}

const MEDIA_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/3gpp': '.3gp',
  'audio/aac': '.aac',
  'audio/amr': '.amr',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'application/pdf': '.pdf'
};

class WhatsappService {
  parseInboundContent(message) {
    return parseInboundContent(message);
  }

  async getWhatsAppConfig(whatsappAccountId = null, options = {}) {
    let accountConfig = null;
    try {
      accountConfig = await whatsappAccountService.runtimeConfig(whatsappAccountId, options);
    } catch (error) {
      logger.warn('whatsapp_account_resolution_failed', { whatsappAccountId, message: error.message });
      if (whatsappAccountId || options.phoneNumberId) throw error;
    }
    if (accountConfig) {
      const preferEnvPhoneNumberId = !whatsappAccountId && !options.phoneNumberId && whatsappConfig.phoneNumberId;
      const config = normalizeConfig({
        ...accountConfig,
        accessToken: whatsappConfig.accessToken || accountConfig.accessToken,
        phoneNumberId: preferEnvPhoneNumberId
          ? whatsappConfig.phoneNumberId
          : accountConfig.phoneNumberId || whatsappConfig.phoneNumberId,
        tokenSource: whatsappConfig.accessToken ? 'env' : 'whatsapp_account',
        phoneNumberIdSource: preferEnvPhoneNumberId
          ? 'env'
          : accountConfig.phoneNumberId ? 'whatsapp_account' : 'env'
      });
      logger.info('whatsapp_credentials_resolved', {
        tokenSource: config.tokenSource,
        phoneNumberIdSource: config.phoneNumberIdSource,
        hasToken: Boolean(config.accessToken),
        phoneNumberId: config.phoneNumberId || null
      });
      return config;
    }
    let settings = {};
    try {
      settings = await whatsappSettingsService.runtimeConfig();
    } catch (error) {
      logger.warn('whatsapp_settings_resolution_failed', {
        message: error.message,
        fallback: 'env'
      });
    }

    const config = normalizeConfig({
      accessToken: whatsappConfig.accessToken || settings.accessToken,
      phoneNumberId: whatsappConfig.phoneNumberId || settings.phoneNumberId,
      verifyToken: settings.verifyToken || whatsappConfig.verifyToken,
      apiVersion: settings.apiVersion || whatsappConfig.apiVersion,
      apiBaseUrl: settings.apiBaseUrl || whatsappConfig.apiBaseUrl,
      tokenSource: whatsappConfig.accessToken ? 'env' : (settings.accessToken ? settings.tokenSource || 'settings' : 'env'),
      phoneNumberIdSource: whatsappConfig.phoneNumberId
        ? 'env'
        : settings.phoneNumberId
        ? settings.phoneNumberIdSource || 'settings'
        : 'env'
    });

    logger.info('whatsapp_credentials_resolved', {
      tokenSource: config.tokenSource,
      phoneNumberIdSource: config.phoneNumberIdSource,
      hasToken: Boolean(config.accessToken),
      phoneNumberId: config.phoneNumberId || null
    });

    return config;
  }

  async getRuntimeConfig(whatsappAccountId = null, options = {}) {
    return this.getWhatsAppConfig(whatsappAccountId, options);
  }

  async requestClient(resolvedConfig = null) {
    const config = normalizeConfig(resolvedConfig || await this.getWhatsAppConfig());
    return {
      config,
      client: axios.create({
        baseURL: `${config.apiBaseUrl}/${config.apiVersion}/${config.phoneNumberId}`,
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 20000
      })
    };
  }

  async sendTextMessage({ to, text, recipientType = 'individual', contextMessageId = null, log = true, whatsappAccountId = null }) {
    const config = normalizeConfig(await this.getWhatsAppConfig(whatsappAccountId));
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: recipientType,
      to,
      type: 'text',
      text: { preview_url: false, body: text }
    };
    if (contextMessageId) {
      payload.context = { message_id: contextMessageId };
    }

    logger.info('whatsapp_outbound_send_attempt', {
      to,
      type: 'text',
      phoneNumberId: config.phoneNumberId,
      tokenSource: config.tokenSource,
      phoneNumberIdSource: config.phoneNumberIdSource
    });

    let response;
    try {
      response = await this.sendRequest(payload, { config });
      logger.info('whatsapp_outbound_send_success', {
        to,
        response
      });
    } catch (error) {
      const metaError = error.response?.data;
      logger.error('whatsapp_outbound_send_failed', {
        to,
        phoneNumberId: config.phoneNumberId,
        tokenSource: config.tokenSource,
        phoneNumberIdSource: config.phoneNumberIdSource,
        ...safeApiError(error)
      });
      error.metaError = metaError;
      throw error;
    }

    if (log) {
      await this.logMessage({
        whatsappMessageId: response.id,
        direction: 'outbound',
        type: 'text',
        text,
        fromNumber: config.phoneNumberId,
        toNumber: to,
        status: 'sent',
        whatsappAccountId: config.whatsappAccountId || null,
        rawPayload: payload
      });
    }

    return response;
  }

  async sendTemplateMessage({ to, templateName, language = 'en_US', components = [], contextMessageId = null, log = true, whatsappAccountId = null }) {
    const config = await this.getRuntimeConfig(whatsappAccountId);
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language },
        components
      }
    };
    if (contextMessageId) {
      payload.context = { message_id: contextMessageId };
    }

    const response = await this.sendRequest(payload, { config });
    if (log) {
      await this.logMessage({
        whatsappMessageId: response.id,
        direction: 'outbound',
        type: 'template',
        templateName,
        fromNumber: config.phoneNumberId,
        toNumber: to,
        status: 'sent',
        whatsappAccountId: config.whatsappAccountId || null,
        rawPayload: payload
      });
    }

    return response;
  }

  async sendInteractiveMessage({ to, body, footer = null, header = null, buttons = [], sections = [], buttonText = 'Choose', log = false, whatsappAccountId = null }) {
    const config = await this.getRuntimeConfig(whatsappAccountId);
    const interactive = {
      type: sections.length ? 'list' : 'button',
      body: { text: body || 'Please choose an option' }
    };
    if (footer) interactive.footer = { text: footer };
    if (header?.text) interactive.header = { type: 'text', text: header.text };
    else if (header?.url && ['image', 'video', 'document'].includes(header.type)) {
      interactive.header = {
        type: header.type,
        [header.type]: {
          link: header.url,
          ...(header.type === 'document' && header.filename ? { filename: header.filename } : {})
        }
      };
    }
    if (sections.length) {
      interactive.action = {
        button: buttonText,
        sections: sections.map((section) => ({
          title: section.title || 'Options',
          rows: (section.rows || []).map((row) => ({
            id: String(row.id || row.payload || row.title),
            title: String(row.title || row.label || row.id),
            description: row.description || undefined
          }))
        }))
      };
    } else {
      interactive.action = {
        buttons: buttons.slice(0, 3).map((button) => ({
          type: 'reply',
          reply: {
            id: String(button.id || button.payload || button.title || button.label),
            title: String(button.title || button.label || button.id).slice(0, 20)
          }
        }))
      };
    }
    const payload = { messaging_product: 'whatsapp', to, type: 'interactive', interactive };
    const response = await this.sendRequest(payload, { config });
    if (log) {
      await this.logMessage({
        whatsappMessageId: response.id, direction: 'outbound', type: 'text',
        messageType: 'interactive', text: body, fromNumber: config.phoneNumberId,
        toNumber: to, status: 'sent', rawPayload: payload, whatsappAccountId: config.whatsappAccountId || null
      });
    }
    return response;
  }

  async sendWhatsAppFlowMessage({ to, body, flowId, flowToken, screen, data = {}, whatsappAccountId = null }) {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: body || 'Continue in WhatsApp' },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_id: flowId,
            flow_token: flowToken,
            flow_cta: 'Continue',
            flow_action: 'navigate',
            flow_action_payload: { screen, data }
          }
        }
      }
    };
    const config = await this.getRuntimeConfig(whatsappAccountId);
    return this.sendRequest(payload, { config });
  }

  async uploadMedia({ filePath, mimeType, whatsappAccountId = null }) {
    const config = await this.getWhatsAppConfig(whatsappAccountId);
    if (!config.accessToken || !config.phoneNumberId) {
      const error = new Error('WhatsApp Cloud API credentials are not configured');
      error.status = 500;
      throw error;
    }

    const fileExists = Boolean(filePath) && fs.existsSync(filePath);
    const uploadUrl = `https://graph.facebook.com/v25.0/${config.phoneNumberId}/media`;

    logger.info('meta_media_upload_attempt', {
      tokenSource: config.tokenSource,
      hasToken: Boolean(config.accessToken),
      phoneNumberId: config.phoneNumberId,
      uploadUrl,
      mimeType: mimeType || null,
      filePathExists: fileExists
    });

    if (!fileExists) {
      const error = new Error('Media file does not exist');
      error.status = 400;
      throw error;
    }

    const createForm = () => {
      const form = new FormData();
      form.append('messaging_product', 'whatsapp');
      form.append('file', fs.createReadStream(filePath), {
        contentType: mimeType || 'application/octet-stream'
      });
      return form;
    };

    try {
      const response = await this.retryRequest(() => {
        const form = createForm();
        return axios.post(uploadUrl, form, {
          headers: {
            ...form.getHeaders(),
            Authorization: `Bearer ${config.accessToken}`
          },
          maxBodyLength: Infinity
        });
      });
      logger.info('meta_media_upload_response', {
        mimeType: mimeType || null,
        responseData: response.data
      });
      return response.data;
    } catch (error) {
      logger.error('meta_media_upload_failed', {
        mimeType: mimeType || null,
        message: error.message,
        status: error.response?.status || null,
        responseData: error.response?.data || null
      });
      if (error.response?.data) {
        error.exposeResponseData = true;
      }
      throw error;
    }
  }

  async sendMediaMessage({
    to,
    mediaType,
    mediaId,
    url,
    caption = '',
    filename,
    mimeType,
    recipientType = 'individual',
    contextMessageId = null,
    log = true,
    returnMetaResponse = false,
    whatsappAccountId = null
  }) {
    const config = await this.getWhatsAppConfig(whatsappAccountId);
    if (!mediaId && !url) {
      const error = new Error('Either mediaId or url is required to send media');
      error.status = 400;
      throw error;
    }

    const mediaPayload = {};
    if (mediaId) mediaPayload.id = mediaId;
    if (url) mediaPayload.link = url;
    if (caption && ['image', 'video', 'document'].includes(mediaType)) mediaPayload.caption = caption;
    if (filename && mediaType === 'document') mediaPayload.filename = filename;

    const payload = {
      messaging_product: 'whatsapp',
      to,
      recipient_type: recipientType,
      type: mediaType,
      [mediaType]: mediaPayload
    };
    if (contextMessageId) {
      payload.context = { message_id: contextMessageId };
    }

    logger.info('whatsapp_media_send_attempt', {
      to,
      mediaType,
      mediaId: mediaId || null,
      url: url || null,
      filename: filename || null,
      mimeType: mimeType || null
    });

    let response;
    let responseData;
    try {
      responseData = await this.sendRequest(payload, { fullResponseData: true, config });
      response = responseData?.messages?.[0] || responseData;
      logger.info('whatsapp_media_send_response', {
        to,
        mediaType,
        mediaId: mediaId || null,
        url: url || null,
        responseData
      });
    } catch (error) {
      logger.error('whatsapp_media_send_failed', {
        to,
        mediaType,
        mediaId: mediaId || null,
        url: url || null,
        message: error.message,
        status: error.response?.status || null,
        responseData: error.response?.data || null
      });
      throw error;
    }
    if (log) {
      await this.logMessage({
        whatsappMessageId: response.id,
        direction: 'outbound',
        type: mediaType,
        mediaId: mediaId || null,
        mediaUrl: url || null,
        text: caption,
        fromNumber: config.phoneNumberId,
        toNumber: to,
        status: 'sent',
        whatsappAccountId: config.whatsappAccountId || null,
        rawPayload: {
          request: payload,
          response: responseData
        }
      });
    }

    return returnMetaResponse ? { message: response, responseData } : response;
  }

  async sendRequest(payload, options = {}) {
    const config = options.config || await this.getWhatsAppConfig();
    const { client } = await this.requestClient(config);
    if (!config.accessToken || !config.phoneNumberId) {
      const error = new Error('WhatsApp Cloud API credentials are not configured');
      error.status = 500;
      throw error;
    }

    try {
      const response = await this.retryRequest(() => client.post('/messages', payload));
      return options.fullResponseData
        ? response.data
        : response.data?.messages?.[0] || response.data;
    } catch (error) {
      error.payloadSent = payload;
      error.whatsappApiResponse = error.response?.data || null;
      throw error;
    }
  }

  async getMediaUrl(mediaId, resolvedConfig = null) {
    if (!mediaId) {
      const error = new Error('Media ID is required to retrieve media URL');
      error.status = 400;
      throw error;
    }

    const config = resolvedConfig || await this.getWhatsAppConfig();
    const response = await this.retryRequest(() => axios.get(
      `${config.apiBaseUrl}/${config.apiVersion}/${mediaId}`,
      {
        headers: { Authorization: `Bearer ${config.accessToken}` },
        timeout: 20000
      }
    ));
    return response.data;
  }

  async downloadMedia(mediaId, whatsappAccountId = null) {
    const config = await this.getWhatsAppConfig(whatsappAccountId);
    const mediaInfo = await this.getMediaUrl(mediaId, config);
    if (!mediaInfo?.url) {
      const error = new Error('Unable to retrieve media URL');
      error.status = 502;
      throw error;
    }

    const downloadResponse = await axios.get(mediaInfo.url, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      responseType: 'arraybuffer',
      timeout: 20000
    });

    return {
      mimeType: downloadResponse.headers['content-type'],
      data: downloadResponse.data,
      filename: mediaInfo.filename || `${mediaId}`
    };
  }

  async processWebhook(payload) {
    const entries = Array.isArray(payload.entry) ? payload.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change.value || {};
        const messages = Array.isArray(value.messages) ? value.messages : [];
        const statuses = Array.isArray(value.statuses) ? value.statuses : [];

        for (const message of messages) {
          await this.handleInboundMessage(value, message);
        }
        // Meta can include several lifecycle transitions for the same message
        // in one webhook. Preserve their payload order instead of racing the
        // database updates against each other.
        for (const status of statuses) {
          await this.handleStatusUpdate(value, status);
        }
      }
    }

    return { received: true };
  }

  async handleInboundMessage(value, message) {
    const parsed = this.parseInboundContent(message);
    logger.info('whatsapp_inbound_message_received', inboundPayloadSummary(message));

    if (!parsed.supported) {
      logger.warn('whatsapp_inbound_message_unsupported', {
        ...inboundPayloadSummary(message),
        interactiveType: parsed.interactiveType || null
      });
      return null;
    }

    if (message.id) {
      const duplicate = await Message.findOne({ where: { whatsappMessageId: message.id } });
      if (duplicate) {
        logger.info('whatsapp_inbound_duplicate_ignored', {
          whatsappMessageId: message.id,
          type: message.type || null,
          messageId: duplicate.id,
          conversationId: duplicate.conversationId || null
        });
        return duplicate;
      }
    }

    const from = message.from;
    const webhookPhoneNumberId = value.metadata?.phone_number_id || null;
    const config = await this.getRuntimeConfig(null, { phoneNumberId: webhookPhoneNumberId });
    const whatsappAccountId = config.whatsappAccountId || null;
    const to = webhookPhoneNumberId || config.phoneNumberId;
    const threadId = [to, from].filter(Boolean).join(':');
    const messageType = parsed.rawType;
    const text = parsed.text;
    const mediaId = message[messageType]?.id || null;
    const mediaUrl = message[messageType]?.url || null;
    const mimeType = message[messageType]?.mime_type || null;
    const fileName = message[messageType]?.filename || null;
    const replyToWhatsappMessageId = message.context?.id || null;
    const receivedAt = statusTimestamp(message.timestamp);

    const contactProfile = value?.contacts?.[0] || message?.contacts?.[0] || {};
    const whatsappId = contactProfile?.wa_id || null;

    if (mediaId) {
      logger.info('whatsapp_inbound_media_received', {
        whatsappMessageId: message.id,
        mediaId,
        type: messageType,
        from
      });
    }

    let assignmentResult = {
      contact: null,
      lead: null,
      assignee: null,
      assignment: null,
      conversation: null,
      followup: null
    };
    try {
      assignmentResult = await leadManagementService.processIncomingWhatsapp({
        from,
        whatsappId,
        profileName: contactProfile?.profile?.name || contactProfile?.name || null,
        text,
        threadId,
        payload: value,
        whatsappAccountId
      });
    } catch (error) {
      console.error(error);
      console.error(error.message);
      console.error(error.stack);
      if (Array.isArray(error.errors)) {
        console.error('Inbound automation validation errors:', error.errors);
      }
    }

    if (!assignmentResult?.conversation) {
      try {
        const contact = assignmentResult?.contact || await contactService.findOrCreateFromWhatsapp({
          phone: from,
          whatsappId,
          firstName: contactProfile?.profile?.name || contactProfile?.name || null,
          lastName: null,
          whatsappAccountId
        });
        const conversation = await conversationService.upsertConversation({
          contactId: contact.id,
          leadId: assignmentResult?.lead?.id || null,
          whatsappThreadId: threadId,
          assignedTo: assignmentResult?.assignee?.id || null,
          lastMessageAt: receivedAt,
          whatsappAccountId
        });
        assignmentResult = { ...assignmentResult, contact, conversation };
        logger.info('whatsapp_inbound_conversation_fallback_resolved', {
          whatsappMessageId: message.id || null,
          contactId: contact.id,
          conversationId: conversation.id
        });
      } catch (error) {
        logger.error('whatsapp_inbound_conversation_fallback_failed', {
          whatsappMessageId: message.id || null,
          from,
          message: error.message
        });
      }
    }

    const conversationId = assignmentResult?.conversation?.id || null;
    const replyToMessage = replyToWhatsappMessageId && conversationId
      ? await Message.findOne({
          where: { conversationId, whatsappMessageId: replyToWhatsappMessageId },
          attributes: ['id', 'whatsappMessageId', 'direction', 'type', 'text', 'mediaUrl', 'templateName', 'rawPayload']
        }).catch(() => null)
      : null;

    const messageRecord = await this.logMessage({
      whatsappMessageId: message.id,
      conversationId,
      contactId: assignmentResult?.contact?.id || null,
      direction: 'inbound',
      channel: 'whatsapp',
      type: parsed.storedType,
      messageType: parsed.messageType,
      text,
      buttonPayload: parsed.buttonPayload,
      interactiveType: parsed.interactiveType,
      mediaId,
      mediaUrl,
      fileName,
      mimeType,
      fromNumber: from,
      toNumber: to,
      status: 'delivered',
      whatsappAccountId,
      statusUpdatedAt: receivedAt,
      replyToMessageId: replyToMessage?.id || null,
      replyToWhatsappMessageId,
      rawPayload: message,
      createdAt: receivedAt,
      updatedAt: receivedAt
    });

    if (conversationId && messageRecord) {
      await assignmentResult.conversation.update({
        lastMessage: text || parsed.messageType || 'WhatsApp message',
        lastMessageAt: receivedAt,
        updatedAt: receivedAt
      }).catch((error) => {
        logger.warn('whatsapp_inbound_conversation_update_failed', {
          conversationId,
          whatsappMessageId: message.id || null,
          message: error.message
        });
      });
    }

    let attachment = null;
    if (mediaId) {
      const downloadedMedia = await this.downloadAndStoreMedia(mediaId, { fileName, mimeType, whatsappAccountId }).catch((error) => {
        logger.warn('whatsapp_media_download_failed', error);
        return null;
      });

      if (downloadedMedia) {
        if (messageRecord) {
          await messageRecord.update({
            mediaUrl: downloadedMedia.storageUrl,
            mediaId
          }).catch((error) => {
            logger.error('whatsapp_media_message_update_failed', {
              whatsappMessageId: message.id,
              message: error.message,
              stack: error.stack
            });
          });
        }

        attachment = await this.saveMediaAttachment({
          conversationId: assignmentResult?.conversation?.id || null,
          messageId: messageRecord?.id,
          fileName: downloadedMedia.fileName,
          originalName: downloadedMedia.fileName,
          mediaType: messageType === 'audio' ? 'audio' : messageType,
          mimeType: downloadedMedia.mimeType,
          size: downloadedMedia.fileSize,
          storagePath: downloadedMedia.storagePath,
          publicUrl: downloadedMedia.storageUrl,
          caption: text
        }).catch((error) => {
          logger.warn('whatsapp_media_attachment_save_failed', error);
          return null;
        });
      }
    }

    if (conversationId && messageRecord) {
      const replyPreview = replyToMessage
        ? {
            id: replyToMessage.id,
            whatsappMessageId: replyToMessage.whatsappMessageId,
            sender: replyToMessage.direction === 'outbound' ? 'You' : 'Customer',
            direction: replyToMessage.direction,
            type: replyToMessage.type,
            text: messagePreviewText(replyToMessage)
          }
        : replyToWhatsappMessageId
          ? {
              id: null,
              whatsappMessageId: replyToWhatsappMessageId,
              sender: 'Previous message',
              type: 'unknown',
              text: 'Replied to a previous message'
            }
          : null;
      const socketPayload = {
        ...(messageRecord?.toJSON ? messageRecord.toJSON() : messageRecord || {}),
        conversationId,
        contactId: assignmentResult?.contact?.id || null,
        leadId: assignmentResult?.lead?.id || null,
        direction: 'inbound',
        text,
        type: messageRecord?.type || parsed.storedType,
        messageType: parsed.messageType,
        buttonPayload: parsed.buttonPayload,
        interactiveType: parsed.interactiveType,
        replyPreview,
        mediaUrl: attachment?.publicUrl || messageRecord?.mediaUrl || mediaUrl,
        createdAt: messageRecord?.createdAt || receivedAt
      };
      logger.info('socket_message_emit', {
        event: 'whatsapp.message.received',
        conversationId,
        messageId: messageRecord?.id || null
      });
      socketService.emitToRoom(`conversation_${conversationId}`, 'whatsapp.message.received', socketPayload);
      await socketService.emitToConversationAudience(conversationId, 'whatsapp.message.received', socketPayload);
    }

    // A concurrent webhook delivery can pass the early lookup before the
    // first request commits. The unique WhatsApp id makes one insert lose;
    // only the request that persisted the inbound message may run automations.
    if (!messageRecord) return null;

    const isTextMessage = messageType === 'text' && !!text;
    const activeReply = isTextMessage
      ? await autoReplyService.findReplyForText(text, whatsappAccountId).catch((error) => {
        logger.warn('whatsapp_auto_reply_lookup_failed', error);
        return null;
      })
      : null;
    const autoReply = activeReply ? activeReply.response : null;

    if (autoReply) {
      await this.sendTextMessage({ to: from, text: autoReply, whatsappAccountId }).catch((error) => {
        logger.warn('whatsapp_auto_reply_send_failed', error);
        return null;
      });
    }

    const flowService = require('./flow.service');
    await flowService.handleInboundMessage({
      text,
      contact: assignmentResult?.contact || null,
      lead: assignmentResult?.lead || null,
      conversation: assignmentResult?.conversation || null,
      messageType: parsed.messageType,
      interactiveType: parsed.interactiveType,
      buttonPayload: parsed.buttonPayload,
      whatsappMessageId: message.id || null,
      replyToWhatsappMessageId,
      rawPayload: message
      , whatsappAccountId
    }).catch((error) => {
      logger.warn('flow_builder_execution_failed', error);
      return null;
    });

  }

  async handleStatusUpdate(value, status) {
    const whatsappMessageId = status?.id || null;
    const nextStatus = typeof status?.status === 'string'
      ? status.status.toLowerCase()
      : null;
    const updatedAt = statusTimestamp(status?.timestamp);
    const errors = statusError(status);

    logger.info('WHATSAPP_STATUS_RECEIVED', {
      whatsappMessageId,
      status: nextStatus,
      recipientId: status?.recipient_id || null,
      timestamp: updatedAt.toISOString(),
      errors: status?.errors || []
    });

    if (!whatsappMessageId || !MESSAGE_STATUSES.has(nextStatus)) {
      logger.warn('whatsapp_status_ignored', {
        whatsappMessageId,
        status: nextStatus,
        reason: whatsappMessageId ? 'unsupported_status' : 'missing_message_id'
      });
      return null;
    }

    const existing = await Message.findOne({ where: { whatsappMessageId } });
    if (existing) {
      await existing.update({
        status: nextStatus,
        statusUpdatedAt: updatedAt,
        errorCode: nextStatus === 'failed' ? errors.errorCode : null,
        errorMessage: nextStatus === 'failed' ? errors.errorMessage : null,
        rawPayload: {
          ...(existing.rawPayload || {}),
          statusUpdate: status
        }
      });
      const flowNodeKey = existing.rawPayload?.nodeKey;
      if (existing.rawPayload?.source === 'flow' && flowNodeKey && ['delivered', 'read', 'failed'].includes(nextStatus)) {
        const flowNode = await FlowNode.findOne({
          where: {
            nodeKey: flowNodeKey,
            ...(existing.rawPayload?.flowId ? { flowId: existing.rawPayload.flowId } : {})
          }
        }).catch(() => null);
        if (flowNode) {
          const stats = { sent: 0, delivered: 0, read: 0, subscribers: 0, errors: 0, ...(flowNode.stats || {}) };
          const key = nextStatus === 'failed' ? 'errors' : nextStatus;
          stats[key] = Number(stats[key] || 0) + 1;
          await flowNode.update({ stats }).catch(() => null);
        }
      }

      const eventPayload = {
        messageId: existing.id,
        whatsappMessageId,
        status: nextStatus,
        timestamp: updatedAt.toISOString(),
        errorCode: nextStatus === 'failed' ? errors.errorCode : null,
        errorMessage: nextStatus === 'failed' ? errors.errorMessage : null
      };
      logger.info('MESSAGE_STATUS_UPDATED', {
        ...eventPayload,
        conversationId: existing.conversationId || null
      });
      if (existing.conversationId) {
        socketService.emitToRoom(
          `conversation_${existing.conversationId}`,
          'message_status_updated',
          eventPayload
        );
      }
      await socketService.emitToConversationAudience(existing.conversationId, 'message_status_updated', eventPayload);
    } else {
      logger.warn('whatsapp_status_message_not_found', {
        whatsappMessageId,
        status: nextStatus
      });
    }

    if (status.id) {
      const queueUpdate = { externalMessageId: status.id };
      if (['delivered', 'read', 'sent'].includes(status.status)) queueUpdate.status = 'sent';
      await MessageQueue.update(queueUpdate, { where: { externalMessageId: status.id } }).catch(() => null);
      const queueItem = await MessageQueue.findOne({ where: { externalMessageId: status.id } }).catch(() => null);
      if (queueItem?.campaignRecipientId && ['sent', 'delivered', 'read', 'failed'].includes(nextStatus)) {
        const recipientUpdate = {
          status: nextStatus,
          externalMessageId: status.id,
          errorMessage: nextStatus === 'failed' ? errors.errorMessage || 'Meta delivery failed' : null
        };
        if (nextStatus === 'sent') recipientUpdate.sentAt = updatedAt;
        if (nextStatus === 'delivered') recipientUpdate.deliveredAt = updatedAt;
        if (nextStatus === 'read') recipientUpdate.readAt = updatedAt;
        await CampaignRecipient.update(recipientUpdate, { where: { id: queueItem.campaignRecipientId } }).catch(() => null);
        await CampaignEvent.create({
          campaignId: queueItem.campaignId,
          recipientId: queueItem.campaignRecipientId,
          eventType: nextStatus,
          payload: { whatsappMessageId: status.id, status }
        }).catch(() => null);
      }
    }

    return existing;
  }

  async downloadAndStoreMedia(mediaId, { fileName, mimeType, whatsappAccountId = null }) {
    const config = await this.getRuntimeConfig(whatsappAccountId);
    const mediaInfo = await this.getMediaUrl(mediaId, config);
    const downloadUrl = mediaInfo?.url;
    if (!downloadUrl) {
      const error = new Error('Media download URL is missing');
      error.status = 502;
      throw error;
    }

    const downloadResponse = await axios.get(downloadUrl, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      responseType: 'arraybuffer',
      timeout: 30000
    });

    const buffer = downloadResponse.data;
    const detectedMimeType = mimeType || downloadResponse.headers['content-type'] || mediaInfo?.mime_type || 'application/octet-stream';
    const resolvedMimeType = String(detectedMimeType).split(';')[0].trim();
    const extension = MEDIA_EXTENSIONS[resolvedMimeType] || '';
    const actualFileName = fileName || mediaInfo?.filename || `${mediaId}${extension}`;
    const storagePath = `whatsapp/${mediaId}/${actualFileName}`;

    const uploadResult = await this.uploadToStorage({ path: storagePath, buffer, mimeType: resolvedMimeType });

    logger.info('whatsapp_media_download_success', {
      mediaId,
      storageUrl: uploadResult.url,
      mimeType: resolvedMimeType,
      fileSize: buffer.length
    });

    return {
      fileName: actualFileName,
      mimeType: resolvedMimeType,
      fileSize: buffer.length,
      storagePath: uploadResult.absolutePath || uploadResult.path,
      storageUrl: uploadResult.url
    };
  }

  async uploadToStorage({ path, buffer, mimeType }) {
    if (!storageService || typeof storageService.uploadToSupabase !== 'function') {
      const error = new Error('Storage service is not available');
      error.status = 500;
      throw error;
    }

    return storageService.uploadToSupabase({ path, buffer, contentType: mimeType });
  }

  async saveMediaAttachment(payload) {
    const { Media } = require('../models');
    if (!Media) {
      return null;
    }

    return Media.create(payload);
  }

  async retryRequest(callback, attempts = 3) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await callback();
      } catch (error) {
        lastError = error;
        const status = error.response?.status;
        const shouldRetry = [429, 500, 502, 503, 504].includes(status) || !status;
        logger.warn('whatsapp_api_request_failed', {
          attempt,
          status,
          message: error.message,
          responseData: error.response?.data || null
        });
        if (!shouldRetry || attempt === attempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    }
    throw lastError;
  }

  async logMessage(payload) {
    try {
      const messagePayload = payload.status && !payload.statusUpdatedAt
        ? { ...payload, statusUpdatedAt: new Date() }
        : payload;
      if (payload.whatsappMessageId) {
        const existing = await Message.findOne({ where: { whatsappMessageId: payload.whatsappMessageId } });
        if (existing) {
          return existing.update(messagePayload);
        }
      }
      return Message.create(messagePayload);
    } catch (error) {
      logger.warn('whatsapp_message_log_failed', error);
      return null;
    }
  }

  async sendImageByUrl({ to, url, caption }) {
    return this.sendMediaMessage({ to, mediaType: 'image', url, caption });
  }

  async sendImageById({ to, mediaId, caption }) {
    return this.sendMediaMessage({ to, mediaType: 'image', mediaId, caption });
  }

  async sendDocumentByUrl({ to, url, filename, caption }) {
    return this.sendMediaMessage({ to, mediaType: 'document', url, filename, caption });
  }

  async sendAudioByUrl({ to, url }) {
    return this.sendMediaMessage({ to, mediaType: 'audio', url });
  }

  async sendVoiceNoteByUrl({ to, url }) {
    return this.sendMediaMessage({ to, mediaType: 'audio', url });
  }

  async sendVideoByUrl({ to, url, caption }) {
    return this.sendMediaMessage({ to, mediaType: 'video', url, caption });
  }

  async sendContactCard({ to, contact }) {
    const config = await this.getRuntimeConfig();
    if (!contact || !contact.phone) {
      const error = new Error('Contact card requires a phone number');
      error.status = 400;
      throw error;
    }

    const formatted = {
      addresses: [],
      phones: [{ phone: contact.phone, type: contact.phoneType || 'CELL', wa_id: contact.whatsappId || contact.phone }],
      name: {
        formatted_name: contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
      }
    };

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'contacts',
      contacts: [formatted]
    };

    const response = await this.sendRequest(payload);
    await this.logMessage({
      whatsappMessageId: response.id,
      direction: 'outbound',
      type: 'contacts',
      fromNumber: config.phoneNumberId,
      toNumber: to,
      status: 'sent',
      rawPayload: payload
    });

    return response;
  }

  async sendLocationMessage({ to, latitude, longitude, name, address, log = true, whatsappAccountId = null }) {
    const config = await this.getRuntimeConfig(whatsappAccountId);
    if (!latitude || !longitude) {
      const error = new Error('Latitude and longitude are required for location messages');
      error.status = 400;
      throw error;
    }

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'location',
      location: {
        latitude: latitude.toString(),
        longitude: longitude.toString(),
        name: name || 'Location',
        address: address || ''
      }
    };

    const response = await this.sendRequest(payload, { config });
    if (log) await this.logMessage({
      whatsappMessageId: response.id,
      direction: 'outbound',
      type: 'location',
      fromNumber: config.phoneNumberId,
      toNumber: to,
      status: 'sent',
      whatsappAccountId: config.whatsappAccountId || null,
      rawPayload: payload
    });

    return response;
  }

  async sendBulkMediaMessages({ to, items = [] }) {
    if (!Array.isArray(items) || items.length === 0) {
      const error = new Error('Bulk media messages require an array of items');
      error.status = 400;
      throw error;
    }

    const results = [];
    for (const item of items) {
      const result = await this.sendMediaMessage({
        to,
        mediaType: item.type,
        mediaId: item.mediaId,
        url: item.url,
        caption: item.caption,
        filename: item.filename,
        mimeType: item.mimeType
      });
      results.push(result);
    }

    return results;
  }
}

module.exports = new WhatsappService();
