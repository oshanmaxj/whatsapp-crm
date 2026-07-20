import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageBubble } from './ChatArea';

const renderBubble = (message) => renderToStaticMarkup(<MessageBubble
  message={{ id: 1, createdAt: '2026-01-01T00:00:00Z', status: 'sent', ...message }}
  onMediaLoad={() => {}} onReply={() => {}} onJumpToMessage={() => {}} onMarkPaymentSlip={() => {}}
/>);

let consoleError;
beforeAll(() => { consoleError = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => consoleError.mockRestore());

test('manual and flow images use the shared media renderer without filename captions', () => {
  const html = renderBubble({
    direction: 'outbound', type: 'image', text: null,
    media: { type: 'image', url: '/api/media/50/download', filename: null },
    rawPayload: { media: { originalFilename: 'Blue Neon Payment.jpg' } }
  });
  expect(html).toContain('<img');
  expect(html).toContain('/api/media/50/download');
  expect(html).not.toContain('Blue Neon Payment.jpg');
});

test('outbound interactive bubbles show read-only titles and media headers', () => {
  const html = renderBubble({
    direction: 'outbound', type: 'interactive', messageType: 'interactive', text: 'Choose an option',
    media: { type: 'image', url: '/api/media/51/download' },
    interactive: { kind: 'button', buttons: [{ id: 'flowbtn_pay_internal', title: 'Pay' }, { id: 'flowbtn_support_internal', title: 'Contact Support' }] }
  });
  expect(html).toContain('Choose an option');
  expect(html).toContain('Pay');
  expect(html).toContain('Contact Support');
  expect(html).not.toContain('flowbtn_pay_internal');
  expect(html).toContain('/api/media/51/download');
});

test('inbound button replies display title and keep payload out of the main bubble', () => {
  const html = renderBubble({
    direction: 'inbound', type: 'text', messageType: 'button_reply', interactiveType: 'button_reply',
    text: 'Pay', buttonPayload: 'flowbtn_machine_identifier',
    interactiveReply: { id: 'flowbtn_machine_identifier', title: 'Pay', replyType: 'button_reply' }
  });
  expect(html).toContain('Pay');
  expect(html).not.toContain('flowbtn_machine_identifier');
});
