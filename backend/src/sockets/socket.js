const { Server } = require('socket.io');
const authService = require('../services/auth.service');
const socketService = require('../services/socket.service');
const chatService = require('../services/chat.service');
const conversationAccessService = require('../services/conversationAccess.service');
const logger = require('../config/logger');
const { corsOptions } = require('../config/cors');

const activeSockets = new Map();

function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: corsOptions.origin,
      methods: ['GET', 'POST'],
      credentials: corsOptions.credentials
    }
  });

  socketService.setIo(io);

  io.on('connection', async (socket) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      socket.disconnect(true);
      return;
    }

    try {
      const payload = authService.verifyAccessToken(token);
      socket.user = payload;
    } catch (error) {
      socket.disconnect(true);
      return;
    }

    const userId = socket.user?.id;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    activeSockets.set(userId, socket.id);
    socket.join(`user_${userId}`);
    let access;
    try {
      access = await conversationAccessService.getUserScope(userId);
    } catch (error) {
      logger.warn('socket_access_scope_failed', error);
      activeSockets.delete(userId);
      socket.disconnect(true);
      return;
    }
    const { scope, user } = access;
    if (scope === 'all') socket.join('inbox_all');
    if (scope !== 'role_only') socket.join(`inbox_user_${userId}`);
    (user.roles || []).forEach((role) => socket.join(socketService.roleRoom(role.id)));
    io.emit('presence:update', { userId, online: true });

    socket.on('chat:join', async ({ conversationId }) => {
      try {
        if (!conversationId) return;
        const unread = await chatService.getConversationUnreadCount(conversationId, userId);
        socket.join(`conversation_${conversationId}`);
        socket.emit('chat:unread', { conversationId, unread });
      } catch (error) {
        logger.warn('socket_chat_join_failed', error);
      }
    });

    socket.on('chat:typing', async ({ conversationId, typing }) => {
      try {
        if (!conversationId) return;
        await conversationAccessService.assertConversationAccess(conversationId, userId);
        socket.to(`conversation_${conversationId}`).emit('chat:typing', {
          conversationId,
          userId,
          typing: !!typing
        });
      } catch (error) {
        logger.warn('socket_chat_typing_failed', error);
      }
    });

    socket.on('chat:message', async ({ conversationId, text }) => {
      try {
        if (!conversationId || !text) return;
        const message = await chatService.sendChatMessage({
          conversationId,
          senderId: userId,
          text
        });

        logger.info('socket_message_emit', {
          event: 'chat:message',
          conversationId,
          messageId: message.id
        });
        io.to(`conversation_${conversationId}`).emit('chat:message', message);
        await socketService.emitToConversationAudience(conversationId, 'chat:message', message);
        const unread = await chatService.getConversationUnreadCount(conversationId, userId);
        io.to(`conversation_${conversationId}`).emit('chat:unread', { conversationId, unread });
      } catch (error) {
        logger.warn('socket_chat_message_failed', error);
        socket.emit('chat:error', {
          message: error.response?.data?.error?.message || error.message || 'Unable to send message'
        });
      }
    });

    socket.on('chat:markRead', async ({ conversationId }) => {
      try {
        if (!conversationId) return;
        await chatService.markConversationRead(conversationId, userId);
        const unread = await chatService.getConversationUnreadCount(conversationId, userId);
        socket.emit('chat:unread', { conversationId, unread });
      } catch (error) {
        logger.warn('socket_mark_read_failed', error);
      }
    });

    socket.on('disconnect', () => {
      activeSockets.delete(userId);
      io.emit('presence:update', { userId, online: false });
    });
  });

  return io;
}

module.exports = initSocket;
