import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config/apiConfig';

export const SOCKET_PATH = '/socket.io';
export const SOCKET_TRANSPORTS = ['polling', 'websocket'];

export function useSocket(token) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [currentToken, setCurrentToken] = useState(token);

  useEffect(() => {
    const updateToken = () => setCurrentToken(localStorage.getItem('accessToken'));
    window.addEventListener('crm-auth-token-changed', updateToken);
    return () => window.removeEventListener('crm-auth-token-changed', updateToken);
  }, []);

  const socketClient = useMemo(() => {
    if (!currentToken) return null;
    return io(SOCKET_URL, {
      auth: { token: currentToken },
      autoConnect: false,
      path: SOCKET_PATH,
      transports: SOCKET_TRANSPORTS,
      upgrade: true,
      withCredentials: true
    });
  }, [currentToken]);

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
