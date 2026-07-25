const { Server } = require('socket.io');
const authService = require('../services/auth.service');
const socketService = require('../services/socket.service');
const chatService = require('../services/chat.service');
const conversationAccessService = require('../services/conversationAccess.service');
const logger = require('../config/logger');
const { corsOptions } = require('../config/cors');

const activeSockets = new Map();
const SOCKET_PATH = '/socket.io';
const socketMetadata = socket => ({
  origin: socket.handshake.headers.origin || null,
  transport: socket.conn.transport.name,
  path: SOCKET_PATH
});

function initSocket(server) {
  const io = new Server(server, {
    path: SOCKET_PATH,
    transports: ['polling', 'websocket'],
    cors: {
      origin: corsOptions.origin,
      methods: ['GET', 'POST'],
      credentials: corsOptions.credentials
    }
  });

  socketService.setIo(io);

  io.engine.on('connection_error', error => {
    logger.warn('socket_engine_connection_failed', {
      origin: error.req?.headers?.origin || null,
      transport: error.req?._query?.transport || null,
      path: error.req?.url?.split('?')[0] || SOCKET_PATH,
      code: error.code,
      message: error.message
    });
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      logger.warn('socket_authentication_failed', { ...socketMetadata(socket), result: 'missing_token' });
      const error = new Error('Authentication required');
      error.data = { code: 'AUTH_REQUIRED' };
      return next(error);
    }

    try {
      socket.user = authService.verifyAccessToken(token);
      logger.info('socket_authentication_succeeded', { ...socketMetadata(socket), result: 'authenticated', userId: socket.user?.id || null });
      return next();
    } catch (error) {
      const code = error.name === 'TokenExpiredError' ? 'AUTH_EXPIRED' : 'AUTH_INVALID';
      logger.warn('socket_authentication_failed', { ...socketMetadata(socket), result: code.toLowerCase() });
      const authError = new Error('Authentication failed');
      authError.data = { code };
      return next(authError);
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user?.id;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    logger.info('socket_connected', { ...socketMetadata(socket), userId });
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

    socket.on('disconnect', reason => {
      activeSockets.delete(userId);
      logger.info('socket_disconnected', { ...socketMetadata(socket), userId, reason });
      io.emit('presence:update', { userId, online: false });
    });
  });

  return io;
}

module.exports = initSocket;
