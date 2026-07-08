import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config/apiConfig';

export function useSocket(token) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);

  const socketClient = useMemo(() => {
    if (!token) return null;
    return io(SOCKET_URL, {
      auth: { token },
      autoConnect: false
    });
  }, [token]);

  useEffect(() => {
    if (!socketClient) return;

    socketClient.connect();
    setSocket(socketClient);

    socketClient.on('connect', () => {
      setConnected(true);
      if (process.env.NODE_ENV === 'development') {
        console.log('WhatsApp CRM socket connected', socketClient.id);
      }
    });
    socketClient.on('disconnect', (reason) => {
      setConnected(false);
      if (process.env.NODE_ENV === 'development') {
        console.log('WhatsApp CRM socket disconnected', reason);
      }
    });

    return () => {
      socketClient.disconnect();
      socketClient.off();
    };
  }, [socketClient]);

  return { socket, connected };
}
