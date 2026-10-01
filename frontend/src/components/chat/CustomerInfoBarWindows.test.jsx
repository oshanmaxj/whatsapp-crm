import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CustomerInfoBar } from './ChatArea';

global.IS_REACT_ACT_ENVIRONMENT = true;

function renderBar(conversation) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

test('shows both the 24H Service Window and 72H Free Entry Window as distinct, separately-labeled indicators', async () => {
  const conversation = {
    contact: {},
    messagingWindow: { isOpen: true, expiresAt: new Date(Date.now() + 8 * 3600000 + 35 * 60000).toISOString() },
    freeEntryWindow: { status: 'active', expiresAt: new Date(Date.now() + 46 * 3600000 + 20 * 60000).toISOString() }
  };
  const { container, root } = renderBar(conversation);
  await act(async () => { root.render(<CustomerInfoBar conversation={conversation} />); });
  const text = container.textContent;
  expect(text).toContain('24H Service Window');
  expect(text).toContain('72H Free Entry Window');
  expect(text).toContain('Inside 24H');
  expect(text).toContain('Active');
  await act(async () => root.unmount());
  container.remove();
});

test('shows the 72H window as Unverified (not falsely active) when no freeEntryWindow data is present at all', async () => {
  const conversation = {
    contact: {},
    messagingWindow: { isOpen: false, expiresAt: null }
  };
  const { container, root } = renderBar(conversation);
  await act(async () => { root.render(<CustomerInfoBar conversation={conversation} />); });
  const text = container.textContent;
  expect(text).toContain('72H Free Entry Window');
  expect(text).toContain('Unverified');
  expect(text).not.toContain('Active');
  await act(async () => root.unmount());
  container.remove();
});

test('an expired 72H window shows "Expired", never implying it still permits every outbound message type', async () => {
  const conversation = {
    contact: {},
    messagingWindow: { isOpen: false, expiresAt: null },
    freeEntryWindow: { status: 'expired', expiresAt: new Date(Date.now() - 1000).toISOString() }
  };
  const { container, root } = renderBar(conversation);
  await act(async () => { root.render(<CustomerInfoBar conversation={conversation} />); });
  const text = container.textContent;
  expect(text).toContain('Expired');
  expect(text).toContain('Window has closed');
  await act(async () => root.unmount());
  container.remove();
});
