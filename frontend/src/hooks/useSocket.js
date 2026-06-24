import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';

const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || 'http://localhost:4000';

export function useSocket(token) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  const socketClient = useMemo(() => {
    if (!token) return null;
    return io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket'],
      autoConnect: false
    });
  }, [token]);

  useEffect(() => {
    if (!socketClient) return;

    socketClient.connect();
    setSocket(socketClient);

    socketClient.on('connect', () => setConnected(true));
    socketClient.on('disconnect', () => setConnected(false));

    return () => {
      socketClient.disconnect();
      socketClient.off();
    };
  }, [socketClient]);

  return { socket, connected };
}
