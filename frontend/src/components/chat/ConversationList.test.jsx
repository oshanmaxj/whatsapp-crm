import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConversationItem } from './ConversationList';

const base = {
  id: 1, status: 'open', unreadCount: 0,
  contact: { firstName: 'Test', lastName: 'Customer' },
  messagingWindow: { isOpen: true, expiresAt: '2099-01-01T00:00:00.000Z' },
  lastMessage: { direction: 'inbound', text: 'Hello', createdAt: '2026-08-08T00:00:00.000Z' }
};

test('row uses the short messaging-window badge without conversation lifecycle badges', () => {
  const html = renderToStaticMarkup(<ConversationItem conversation={base} selected={false} onSelect={() => {}} />);
  expect(html).toContain('Open');
  expect(html).toContain('Customer messaging window is currently open.');
  expect(html).not.toContain('24h Open');
  expect(html).not.toContain('Conversation Active');
});

test('closed messaging window is labelled Outside window, not Closed', () => {
  const html = renderToStaticMarkup(<ConversationItem conversation={{ ...base, messagingWindow: { isOpen: false, expiresAt: null } }} selected={false} onSelect={() => {}} />);
  expect(html).toContain('Outside window');
  expect(html).toContain('Only an approved template can be initiated outside the customer messaging window.');
  expect(html).not.toContain('Conversation Closed');
});

test('Inbox source has no conversation Status filter or hardcoded lead-status registry', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, 'ConversationList.jsx'), 'utf8');
  expect(source).not.toContain("InputLabel>Status</InputLabel>");
  expect(source).not.toContain('LEAD_STATUSES');
  expect(source).toContain('leadStatuses');
});
