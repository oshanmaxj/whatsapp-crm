const path = require('path');
const fs = require('fs');
const inboxService = require('../services/inbox.service');
const chatService = require('../services/chat.service');
const socketService = require('../services/socket.service');
const logger = require('../config/logger');
const { safeApiError } = require('../services/whatsapp.service');

class MediaController {
  async upload(req, res, next) {
    try {
      if (['audio', 'voice'].includes(String(req.body?.mediaType || '').toLowerCase()) && !req.user?.isSystemAdmin && !req.user?.permissions?.includes('voice.send')) {
        throw Object.assign(new Error('Voice message permission is required.'), { status: 403, code: 'VOICE_SEND_FORBIDDEN' });
      }
      logger.info('media_file_upload_received', {
        conversationId: req.body?.conversationId || null,
        uploadedBy: req.user?.id || null,
        fileName: req.body?.fileName || null,
        mimeType: req.body?.mimeType || null,
        mediaType: req.body?.mediaType || null,
        byteLength: typeof req.body?.dataBase64 === 'string' ? Math.floor(req.body.dataBase64.length * 3 / 4) : 0
      });
      const media = await inboxService.createMedia({ ...req.body, uploadedBy: req.user?.id || null }, req.user.id);
      const message = await chatService.getMessageWithReplyPreview(media.messageId);
      const conversationId = media.conversationId;
      socketService.emitToRoom(`conversation_${conversationId}`, 'chat:message', message);
      await socketService.emitToConversationAudience(conversationId, 'chat:message', message);
      return res.status(201).json({
        success: true,
        data: {
          ...(() => { const value = media.toJSON ? media.toJSON() : { ...media }; delete value.storagePath; return value; })(),
          message
        }
      });
    } catch (err) {
      const metaMessage = err.response?.data?.error?.error_user_msg
        || err.response?.data?.error?.message
        || err.response?.data?.message;
      logger.error('media_file_upload_failed', {
        conversationId: req.body?.conversationId || null,
        mediaType: req.body?.mediaType || null,
        mimeType: req.body?.mimeType || null,
        byteLength: typeof req.body?.dataBase64 === 'string' ? Math.floor(req.body.dataBase64.length * 3 / 4) : 0,
        ...safeApiError(err)
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
      return res.status(200).json({ success: true, data: data.map((row) => { const value = row.toJSON ? row.toJSON() : { ...row }; delete value.storagePath; return value; }) });
    } catch (err) {
      next(err);
    }
  }

  async download(req, res, next) {
    try {
      const media = await inboxService.getMedia(req.params.id, req.user.id);
      const stat = await fs.promises.stat(media.storagePath);
      const range = req.headers.range;
      const fileName = media.originalName || path.basename(media.storagePath);
      res.setHeader('Content-Type', media.mimeType || 'application/octet-stream');
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Disposition', `${media.mediaType === 'document' || media.mediaType === 'pdf' ? 'attachment' : 'inline'}; filename="${String(fileName).replace(/["\r\n]/g, '_')}"`);
      if (!range) {
        res.setHeader('Content-Length', stat.size);
        return fs.createReadStream(media.storagePath).pipe(res);
      }
      const match = String(range).match(/^bytes=(\d*)-(\d*)$/);
      if (!match) return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= stat.size) {
        return res.status(416).set('Content-Range', `bytes */${stat.size}`).end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
      res.setHeader('Content-Length', end - start + 1);
      return fs.createReadStream(media.storagePath, { start, end }).pipe(res);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new MediaController();
