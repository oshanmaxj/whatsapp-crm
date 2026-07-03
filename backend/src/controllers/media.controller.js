const path = require('path');
const inboxService = require('../services/inbox.service');
const chatService = require('../services/chat.service');
const socketService = require('../services/socket.service');
const logger = require('../config/logger');

class MediaController {
  async upload(req, res, next) {
    try {
      logger.info('media_file_upload_received', {
        conversationId: req.body?.conversationId || null,
        uploadedBy: req.user?.id || null,
        fileName: req.body?.fileName || null,
        mimeType: req.body?.mimeType || null,
        mediaType: req.body?.mediaType || null,
        encodedBytes: typeof req.body?.dataBase64 === 'string' ? req.body.dataBase64.length : 0
      });
      const media = await inboxService.createMedia({ ...req.body, uploadedBy: req.user?.id || null }, req.user.id);
      const message = await chatService.getMessageWithReplyPreview(media.messageId);
      const conversationId = media.conversationId;
      socketService.emitToRoom(`conversation_${conversationId}`, 'chat:message', message);
      await socketService.emitToConversationAudience(conversationId, 'chat:message', message);
      return res.status(201).json({
        success: true,
        data: {
          ...(media.toJSON ? media.toJSON() : media),
          message
        }
      });
    } catch (err) {
      const metaMessage = err.response?.data?.error?.error_user_msg
        || err.response?.data?.error?.message
        || err.response?.data?.message;
      logger.error('media_file_upload_failed', {
        conversationId: req.body?.conversationId || null,
        fileName: req.body?.fileName || null,
        message: err.message,
        status: err.response?.status || err.status || null,
        responseData: err.response?.data || null
      });
      if (err.response) {
        err.status = err.response.status >= 400 && err.response.status < 500 ? 400 : 502;
        err.message = metaMessage || err.message;
      }
      next(err);
    }
  }

  async list(req, res, next) {
    try {
      const data = await inboxService.listMedia(req.query.conversationId, req.user.id);
      return res.status(200).json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async download(req, res, next) {
    try {
      const media = await inboxService.getMedia(req.params.id, req.user.id);
      return res.download(media.storagePath, media.originalName || path.basename(media.storagePath));
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new MediaController();
