const axios = require('axios');
const { Message, MessageQueue } = require('../models');
const whatsappConfig = require('../config/whatsapp');
const whatsappSettingsService = require('./whatsappSettings.service');
const leadManagementService = require('./leadManagement.service');
const aiService = require('./ai.service');
const autoReplyService = require('./autoReply.service');
const socketService = require('./socket.service');
const storageService = require('./storage.service');
const logger = require('../config/logger');

class WhatsappService {
  async getRuntimeConfig() {
    const settings = await whatsappSettingsService.runtimeConfig().catch(() => ({}));
    return {
      accessToken: settings.accessToken || whatsappConfig.accessToken,
      phoneNumberId: settings.phoneNumberId || whatsappConfig.phoneNumberId,
      verifyToken: settings.verifyToken || whatsappConfig.verifyToken,
      apiVersion: settings.apiVersion || whatsappConfig.apiVersion,
      apiBaseUrl: settings.apiBaseUrl || whatsappConfig.apiBaseUrl
    };
  }

  async requestClient() {
    const config = await this.getRuntimeConfig();
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

  async sendTextMessage({ to, text, recipientType = 'individual', log = true }) {
    const config = await this.getRuntimeConfig();
    const payload = {
      messaging_product: 'whatsapp',
      to,
      recipient_type: recipientType,
      type: 'text',
      text: { body: text }
    };

    const response = await this.sendRequest(payload);
    if (log) {
      await this.logMessage({
        whatsappMessageId: response.id,
        direction: 'outbound',
        type: 'text',
        text,
        fromNumber: config.phoneNumberId,
        toNumber: to,
        status: 'sent',
        rawPayload: payload
      });
    }

    return response;
  }

  async sendTemplateMessage({ to, templateName, language = 'en_US', components = [] }) {
    const config = await this.getRuntimeConfig();
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

    const response = await this.sendRequest(payload);
    await this.logMessage({
      whatsappMessageId: response.id,
      direction: 'outbound',
      type: 'template',
      templateName,
      fromNumber: config.phoneNumberId,
      toNumber: to,
      status: 'sent',
      rawPayload: payload
    });

    return response;
  }

  async sendMediaMessage({ to, mediaType, mediaId, url, caption = '', filename, mimeType, recipientType = 'individual' }) {
    const config = await this.getRuntimeConfig();
    if (!mediaId && !url) {
      const error = new Error('Either mediaId or url is required to send media');
      error.status = 400;
      throw error;
    }

    const mediaPayload = { caption };
    if (mediaId) mediaPayload.id = mediaId;
    if (url) mediaPayload.link = url;
    if (filename) mediaPayload.filename = filename;
    if (mimeType) mediaPayload.mime_type = mimeType;

    const payload = {
      messaging_product: 'whatsapp',
      to,
      recipient_type: recipientType,
      type: mediaType,
      [mediaType]: mediaPayload
    };

    const response = await this.sendRequest(payload);
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
      rawPayload: payload
    });

    return response;
  }

  async sendRequest(payload) {
    const { config, client } = await this.requestClient();
    if (!config.accessToken || !config.phoneNumberId) {
      const error = new Error('WhatsApp Cloud API credentials are not configured');
      error.status = 500;
      throw error;
    }

    const response = await this.retryRequest(() => client.post('/messages', payload));
    return response.data?.messages?.[0] || response.data;
  }

  async getMediaUrl(mediaId) {
    if (!mediaId) {
      const error = new Error('Media ID is required to retrieve media URL');
      error.status = 400;
      throw error;
    }

    const { client } = await this.requestClient();
    const response = await this.retryRequest(() => client.get(`/media/${mediaId}`));
    return response.data;
  }

  async downloadMedia(mediaId) {
    const mediaInfo = await this.getMediaUrl(mediaId);
    if (!mediaInfo?.url) {
      const error = new Error('Unable to retrieve media URL');
      error.status = 502;
      throw error;
    }

    const config = await this.getRuntimeConfig();
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

        await Promise.all(messages.map((message) => this.handleInboundMessage(value, message)));
        await Promise.all(statuses.map((status) => this.handleStatusUpdate(value, status)));
      }
    }

    return { received: true };
  }

  async handleInboundMessage(value, message) {
    const from = message.from;
    const config = await this.getRuntimeConfig();
    const to = value.metadata?.phone_number_id || config.phoneNumberId;
    const threadId = [to, from].filter(Boolean).join(':');
    const messageType = message.type;
    const text = message.text?.body || null;
    const mediaId = message[messageType]?.id || null;
    const mediaUrl = message[messageType]?.url || null;
    const mimeType = message[messageType]?.mime_type || null;
    const fileName = message[messageType]?.filename || null;

    const contactProfile = value?.contacts?.[0] || message?.contacts?.[0] || {};
    const whatsappId = contactProfile?.wa_id || null;

    const assignmentResult = await leadManagementService.processIncomingWhatsapp({
      from,
      whatsappId,
      profileName: contactProfile?.profile?.name || contactProfile?.name || null,
      text,
      threadId,
      payload: value
    });

    const messageRecord = await this.logMessage({
      whatsappMessageId: message.id,
      conversationId: assignmentResult.conversation.id,
      contactId: assignmentResult.contact.id,
      direction: 'inbound',
      type: messageType,
      text,
      mediaId,
      mediaUrl,
      fileName,
      mimeType,
      fromNumber: from,
      toNumber: to,
      status: 'received',
      rawPayload: message
    });

    let attachment = null;
    if (mediaId) {
      const downloadedMedia = await this.downloadAndStoreMedia(mediaId, { fileName, mimeType }).catch((error) => {
        logger.warn('whatsapp_media_download_failed', error);
        return null;
      });

      if (downloadedMedia) {
        attachment = await this.saveMediaAttachment({
          messageId: messageRecord?.id,
          contactId: assignmentResult.contact.id,
          fileName: downloadedMedia.fileName,
          fileType: messageType,
          mimeType: downloadedMedia.mimeType,
          fileSize: downloadedMedia.fileSize,
          whatsappMediaId: mediaId,
          storageUrl: downloadedMedia.storageUrl
        }).catch((error) => {
          logger.warn('whatsapp_media_attachment_save_failed', error);
          return null;
        });
      }
    }

    const isTextMessage = messageType === 'text' && !!text;
    const activeReply = isTextMessage ? await autoReplyService.findReplyForText(text) : null;
    const autoReply = activeReply ? activeReply.response : null;

    if (autoReply) {
      await this.sendTextMessage({ to: from, text: autoReply });
    }

    socketService.emitToRoom(`conversation_${assignmentResult.conversation.id}`, 'whatsapp.message.received', {
      conversationId: assignmentResult.conversation.id,
      contactId: assignmentResult.contact.id,
      leadId: assignmentResult.lead.id,
      text,
      type: messageType,
      mediaUrl: attachment?.storageUrl || mediaUrl,
      receivedAt: new Date()
    });
  }

  async handleStatusUpdate(value, status) {
    const config = await this.getRuntimeConfig();
    const existing = status.id ? await Message.findOne({ where: { whatsappMessageId: status.id } }) : null;
    if (existing) {
      await existing.update({ status: status.status || existing.status, rawPayload: status });
    }
    if (status.id) {
      const queueUpdate = { externalMessageId: status.id };
      if (['delivered', 'read', 'sent'].includes(status.status)) queueUpdate.status = 'sent';
      await MessageQueue.update(queueUpdate, { where: { externalMessageId: status.id } }).catch(() => null);
    }
    await this.logMessage({
      whatsappMessageId: status.id,
      direction: 'outbound',
      type: 'text',
      fromNumber: config.phoneNumberId,
      toNumber: status.recipient_id,
      status: status.status || 'sent',
      rawPayload: status
    });
  }

  async downloadAndStoreMedia(mediaId, { fileName, mimeType }) {
    const mediaInfo = await this.getMediaUrl(mediaId);
    const downloadUrl = mediaInfo?.url;
    if (!downloadUrl) {
      const error = new Error('Media download URL is missing');
      error.status = 502;
      throw error;
    }

    const config = await this.getRuntimeConfig();
    const downloadResponse = await axios.get(downloadUrl, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      responseType: 'arraybuffer',
      timeout: 30000
    });

    const buffer = downloadResponse.data;
    const resolvedMimeType = mimeType || downloadResponse.headers['content-type'] || mediaInfo?.mime_type;
    const actualFileName = fileName || mediaInfo?.filename || `${mediaId}`;
    const storagePath = `whatsapp/${mediaId}/${actualFileName}`;

    const uploadResult = await this.uploadToStorage({ path: storagePath, buffer, mimeType: resolvedMimeType });

    return {
      fileName: actualFileName,
      mimeType: resolvedMimeType,
      fileSize: buffer.length,
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
    const { MediaFile } = require('../models');
    if (!MediaFile) {
      return null;
    }

    return MediaFile.create(payload);
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
        logger.warn('whatsapp_api_request_failed', { attempt, status, error });
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
      if (payload.whatsappMessageId) {
        const existing = await Message.findOne({ where: { whatsappMessageId: payload.whatsappMessageId } });
        if (existing) {
          return existing.update(payload);
        }
      }
      return Message.create(payload);
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

  async sendLocationMessage({ to, latitude, longitude, name, address }) {
    const config = await this.getRuntimeConfig();
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

    const response = await this.sendRequest(payload);
    await this.logMessage({
      whatsappMessageId: response.id,
      direction: 'outbound',
      type: 'location',
      fromNumber: config.phoneNumberId,
      toNumber: to,
      status: 'sent',
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
