import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { SOCKET_URL } from '../config/apiConfig';
import { clearAuthState, refreshAccessToken } from '../services/api';

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
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      randomizationFactor: 0.5,
      timeout: 20000
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
    socketClient.on('connect_error', async (error) => {
      const code = error?.data?.code;
      if (!['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED'].includes(code)) return;
      socketClient.io.reconnection(false);
      try {
        await refreshAccessToken();
      } catch {
        clearAuthState();
        if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('authNotice', 'Your session expired. Please sign in again.');
        if (window.location.pathname !== '/login') window.location.assign('/login');
      }
    });

    return () => {
      socketClient.disconnect();
      socketClient.off();
    };
  }, [socketClient]);

  return { socket, connected };
}
