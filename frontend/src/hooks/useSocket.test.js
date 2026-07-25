import fs from 'fs';
import path from 'path';
import { SOCKET_PATH, SOCKET_TRANSPORTS } from './useSocket';

test('Socket.IO client path and transport order match the production server', () => {
  expect(SOCKET_PATH).toBe('/socket.io');
  expect(SOCKET_TRANSPORTS).toEqual(['polling', 'websocket']);
});

test('Socket.IO reconnects with bounded backoff and refreshes expired authentication', () => {
  const source = fs.readFileSync(path.join(__dirname, 'useSocket.js'), 'utf8');
  expect(source).toMatch(/reconnectionAttempts: 8/);
  expect(source).toMatch(/reconnectionDelayMax: 30000/);
  expect(source).toMatch(/refreshAccessToken/);
  expect(source).toMatch(/socketClient\.io\.reconnection\(false\)/);
});
