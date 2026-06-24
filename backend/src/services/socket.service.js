let io = null;

class SocketService {
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
}

module.exports = new SocketService();
