let io = null;
const { Conversation } = require('../models');

function roleRoom(roleId) {
  return `inbox_role_${roleId}`;
}

class SocketService {
  roleRoom(roleId) {
    return roleRoom(roleId);
  }

  setIo(server) {
    io = server;
  }

  emitToUser(userId, event, payload) {
    if (!io || !userId) return;
    io.to(`user_${userId}`).emit(event, payload);
  }

  emitToRoom(room, event, payload) {
    if (!io) return;
    io.to(room).emit(event, payload);
  }

  async emitToConversationAudience(conversationId, event, payload) {
    if (!io || !conversationId) return;
    io.to('inbox_all').emit(event, payload);

    const conversation = await Conversation.findByPk(conversationId, {
      attributes: ['id', 'assignedUserId', 'assignedRoleId']
    }).catch(() => null);
    if (!conversation) return;
    if (conversation.assignedUserId) io.to(`inbox_user_${conversation.assignedUserId}`).emit(event, payload);
    if (conversation.assignedRoleId) io.to(roleRoom(conversation.assignedRoleId)).emit(event, payload);
  }
}

module.exports = new SocketService();
