const { Server } = require('socket.io');
const authService = require('../services/auth.service');
const socketService = require('../services/socket.service');
const chatService = require('../services/chat.service');
const logger = require('../config/logger');

const activeSockets = new Map();

function initSocket(server) {
  const io = new Server(server, {
    cors: {
      origin: process.env.FRONTEND_URL || '*',
      methods: ['GET', 'POST'],
      credentials: true
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
    io.emit('presence:update', { userId, online: true });

    socket.on('chat:join', async ({ conversationId }) => {
      try {
        if (!conversationId) return;
        socket.join(`conversation_${conversationId}`);
        const unread = await chatService.getConversationUnreadCount(conversationId, userId);
        socket.emit('chat:unread', { conversationId, unread });
      } catch (error) {
        logger.warn('socket_chat_join_failed', error);
      }
    });

    socket.on('chat:typing', ({ conversationId, typing }) => {
      if (!conversationId) return;
      socket.to(`conversation_${conversationId}`).emit('chat:typing', {
        conversationId,
        userId,
        typing: !!typing
      });
    });

    socket.on('chat:message', async ({ conversationId, text }) => {
      try {
        if (!conversationId || !text) return;
        const message = await chatService.sendChatMessage({
          conversationId,
          senderId: userId,
          text
        });

        io.to(`conversation_${conversationId}`).emit('chat:message', message);
        const unread = await chatService.getConversationUnreadCount(conversationId, userId);
        io.to(`conversation_${conversationId}`).emit('chat:unread', { conversationId, unread });
      } catch (error) {
        logger.warn('socket_chat_message_failed', error);
        socket.emit('chat:error', { message: 'Unable to send message' });
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
