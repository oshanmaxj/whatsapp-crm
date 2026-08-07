const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateMessagingWindow } = require('../src/services/messagingWindow.service');

test('latest inbound timestamp opens the canonical window', () => {
  const result = calculateMessagingWindow('2026-08-07T00:00:00.000Z', '2026-08-07T23:59:59.000Z');
  assert.equal(result.isOpen, true);
  assert.equal(result.expiresAt, '2026-08-08T00:00:00.000Z');
  assert.equal(result.reason, 'CUSTOMER_SERVICE_WINDOW');
});

test('window closes exactly 24 hours after the inbound message', () => {
  assert.equal(calculateMessagingWindow('2026-08-07T00:00:00.000Z', '2026-08-08T00:00:00.000Z').isOpen, false);
});

test('no inbound customer message is closed with a stable reason', () => {
  assert.deepEqual(calculateMessagingWindow(null), {
    isOpen: false, openedAt: null, expiresAt: null, remainingSeconds: 0, reason: 'NO_INBOUND_CUSTOMER_MESSAGE'
  });
});

test('a later inbound message reopens an expired window', () => {
  const expired = calculateMessagingWindow('2026-08-05T00:00:00.000Z', '2026-08-07T00:00:00.000Z');
  const reopened = calculateMessagingWindow('2026-08-06T12:00:00.001Z', '2026-08-07T00:00:00.000Z');
  assert.equal(expired.isOpen, false);
  assert.equal(reopened.isOpen, true);
});
