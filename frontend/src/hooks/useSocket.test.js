import { SOCKET_PATH, SOCKET_TRANSPORTS } from './useSocket';

test('Socket.IO client path and transport order match the production server', () => {
  expect(SOCKET_PATH).toBe('/socket.io');
  expect(SOCKET_TRANSPORTS).toEqual(['polling', 'websocket']);
});
