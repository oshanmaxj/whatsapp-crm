const chatService = require('../services/chat.service');
const socketService = require('../services/socket.service');
const logger = require('../config/logger');

class ChatController {
  async templateDiagnostics(req, res, next) {
    try { return res.json({ success: true, data: await chatService.getTemplateDiagnostics(req.params.conversationId, req.user.id, req.query.templateName, req.query.languageCode) }); }
    catch (err) { next(err); }
  }
  async getConversations(req, res, next) {
    try {
      const userId = req.user.id;
      const conversations = await chatService.getConversationList(userId);
      return res.status(200).json({ success: true, data: conversations });
    } catch (err) {
      next(err);
    }
  }

  async getMessages(req, res, next) {
    try {
      const { conversationId } = req.params;
      const messages = await chatService.getConversationMessages(conversationId, req.user.id);
      return res.status(200).json({ success: true, data: messages });
    } catch (err) {
      next(err);
    }
  }

  async sendMessage(req, res) {
    try {
      const { conversationId } = req.params;
      const text = String(req.body.text || '').trim();
      if (!text) {
        return res.status(400).json({ success: false, message: 'Message text is required' });
      }

      const message = await chatService.sendChatMessage({
        conversationId,
        senderId: req.user.id,
        text,
        replyToMessageId: req.body.replyToMessageId || null
      });
      const payload = message.toJSON ? message.toJSON() : message;
      logger.info('socket_message_emit', {
        event: 'chat:message',
        conversationId,
        messageId: payload.id
      });
      socketService.emitToRoom(`conversation_${conversationId}`, 'chat:message', payload);
      await socketService.emitToConversationAudience(conversationId, 'chat:message', payload);

      return res.status(201).json({ success: true, data: payload });
    } catch (error) {
      const upstreamStatus = error.response?.status;
      const metaError = error.metaError || error.response?.data;
      const metaMessage = error.response?.data?.error?.error_user_msg
        || error.response?.data?.error?.message
        || error.response?.data?.message;
      const status = error.response
        ? (upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502)
        : (error.status || 502);

      logger.warn('chat_message_send_failed', {
        conversationId: req.params.conversationId,
        userId: req.user?.id || null,
        status,
        upstreamStatus: upstreamStatus || null,
        message: metaMessage || error.message,
        metaError
      });

      return res.status(status).json({
        success: false,
        code: error.code || (error.response ? 'WHATSAPP_SEND_FAILED' : 'MESSAGE_SEND_FAILED'),
        message: metaMessage || error.message || 'Unable to send WhatsApp message',
        metaError,
        data: error.messageRecord?.toJSON ? error.messageRecord.toJSON() : error.messageRecord
      });
    }
  }

  async sendInteractive(req, res) {
    try {
      const message = await chatService.sendChatInteractive({
        conversationId: req.params.conversationId,
        senderId: req.user.id,
        body: req.body.body,
        footer: req.body.footer,
        header: req.body.header,
        buttons: req.body.buttons,
        clientRequestId: req.body.clientRequestId
      });
      const payload = message?.toJSON ? message.toJSON() : message;
      socketService.emitToRoom(`conversation_${req.params.conversationId}`, 'chat:message', payload);
      await socketService.emitToConversationAudience(req.params.conversationId, 'chat:message', payload);
      return res.status(201).json({ success: true, data: payload });
    } catch (error) {
      const meta = error.whatsappApiResponse?.error || error.response?.data?.error || error.metaError?.error || {};
      logger.warn('chat_interactive_send_failed', {
        conversationId: req.params.conversationId,
        userId: req.user?.id || null,
        code: meta.code || error.code || null,
        subcode: meta.error_subcode || null,
        type: meta.type || null,
        message: meta.error_user_msg || meta.message || error.message
      });
      return res.status(error.response ? 502 : (error.status || 500)).json({
        success: false, code: error.code || 'WHATSAPP_INTERACTIVE_SEND_FAILED',
        message: meta.error_user_msg || meta.message || error.message || 'Unable to send interactive message',
        data: error.messageRecord?.toJSON ? error.messageRecord.toJSON() : error.messageRecord
      });
    }
  }

  async sendTemplate(req, res) {
    try {
      const templateName = String(req.body.templateName || '').trim();
      const languageCode = String(req.body.languageCode || 'en_US').trim();
      const components = Array.isArray(req.body.components) ? req.body.components : [];
      if (!templateName) {
        return res.status(400).json({ success: false, message: 'Template name is required' });
      }

      const message = await chatService.sendChatTemplate({
        conversationId: req.params.conversationId,
        senderId: req.user.id,
        templateName,
        languageCode,
        components,
        replyToMessageId: req.body.replyToMessageId || null
      });
      const payload = message.toJSON ? message.toJSON() : message;
      socketService.emitToRoom(`conversation_${req.params.conversationId}`, 'chat:message', payload);
      await socketService.emitToConversationAudience(req.params.conversationId, 'chat:message', payload);
      return res.status(201).json({ success: true, data: payload });
    } catch (error) {
      const metaError = error.metaError || error.response?.data;
      const metaMessage = metaError?.error?.error_user_msg
        || metaError?.error?.message
        || metaError?.message;
      const status = error.response ? 502 : (error.status || 500);
      logger.warn('chat_template_send_failed', {
        conversationId: req.params.conversationId,
        userId: req.user?.id || null,
        status,
        message: metaMessage || error.message,
        metaError
      });
      return res.status(status).json({
        success: false,
        code: error.code || (error.response ? 'WHATSAPP_TEMPLATE_SEND_FAILED' : 'TEMPLATE_SEND_FAILED'),
        message: metaMessage || error.message || 'Unable to send WhatsApp template',
        metaError,
        data: error.messageRecord?.toJSON ? error.messageRecord.toJSON() : error.messageRecord
      });
    }
  }

  async getUnread(req, res, next) {
    try {
      const userId = req.user.id;
      const unread = await chatService.getUnreadCountsForUser(userId);
      return res.status(200).json({ success: true, data: { unread } });
    } catch (err) {
      next(err);
    }
  }

  async getMessageStatus(req, res, next) {
    try {
      const message = await chatService.getMessageStatus(req.params.id, req.user.id);
      return res.status(200).json({
        id: message.id,
        whatsappMessageId: message.whatsappMessageId,
        status: message.status,
        statusUpdatedAt: message.statusUpdatedAt
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ChatController();
