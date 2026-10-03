import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ChatPage from './ChatPage';
import * as chatService from '../services/chat.service';
import * as facebookMessengerService from '../services/facebookMessenger.service';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useOutletContext: () => ({ socket: null, connected: false })
}));
jest.mock('../services/chat.service');
jest.mock('../services/facebookMessenger.service', () => ({ __esModule: true, sendFacebookMessage: jest.fn() }));
jest.mock('../services/callCenter.service', () => ({ __esModule: true, getActiveCall: jest.fn() }));
jest.mock('../services/userManagement.service', () => ({ __esModule: true, getRoles: jest.fn() }));
jest.mock('../services/whatsappTemplate.service', () => ({ __esModule: true, listWhatsAppTemplates: jest.fn() }));
jest.mock('../hooks/useLeadStatuses', () => ({ __esModule: true, default: () => [] }));

import { getActiveCall } from '../services/callCenter.service';
import { getRoles } from '../services/userManagement.service';
import { listWhatsAppTemplates } from '../services/whatsappTemplate.service';

global.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom does not implement scrollIntoView at all; ChatArea calls it on new
// messages, unrelated to anything under test here.
window.HTMLElement.prototype.scrollIntoView = jest.fn();
const ok = (data) => Promise.resolve({ data: { data } });

const whatsappConversation = { id: 10, channel: 'whatsapp', contactId: 1, whatsappAccountId: 7, contact: { firstName: 'Wendy', lastName: 'Apple' }, lastInboundAt: new Date().toISOString() };
const facebookConversation = { id: 20, channel: 'facebook_messenger', contactId: 2, contact: { firstName: 'Fiona', lastName: 'Book' } };

function mockChatServiceDefaults() {
  getActiveCall.mockReturnValue(ok(null));
  getRoles.mockReturnValue(ok([]));
  listWhatsAppTemplates.mockReturnValue(ok([]));
  chatService.getConversations.mockReturnValue(ok({ items: [whatsappConversation, facebookConversation] }));
  chatService.getConversationCounts.mockReturnValue(ok({}));
  chatService.getAssignableUsers.mockReturnValue(ok([]));
  chatService.getLabels.mockReturnValue(ok([]));
  chatService.getTemplates.mockReturnValue(ok([]));
  chatService.getUnreadCount.mockReturnValue(ok(0));
  chatService.getConversation.mockImplementation((id) => ok(String(id) === '20' ? facebookConversation : whatsappConversation));
  chatService.getConversationMessages.mockReturnValue(ok({ items: [] }));
  chatService.getMedia.mockReturnValue(ok([]));
  chatService.getNotes.mockReturnValue(ok([]));
  chatService.markConversationRead.mockReturnValue(ok({}));
  chatService.sendConversationMessage.mockReturnValue(ok({ id: 9001, status: 'sent' }));
  chatService.sendConversationTemplate.mockReturnValue(ok({ id: 9002, status: 'sent' }));
  facebookMessengerService.sendFacebookMessage.mockReturnValue(ok({ id: 9003, status: 'sent' }));
}

function renderPage() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

async function selectConversationAndType(container, conversationId, text) {
  const name = conversationId === 20 ? 'Fiona Book' : 'Wendy Apple';
  // React attaches its click listener via delegation, not a literal
  // `.onclick` property, so a bubbling click dispatched on the element that
  // holds the contact's name reaches whichever ancestor is actually wired
  // to select this conversation.
  const target = Array.from(container.querySelectorAll('*')).find((el) => el.textContent === name);
  if (!target) throw new Error(`Could not find a rendered element with text "${name}"`);
  await act(async () => { target.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
  const textarea = container.querySelector('textarea');
  await act(async () => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    nativeInputValueSetter.call(textarea, text);
    textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockChatServiceDefaults();
});

test('a Facebook Messenger conversation sends through sendFacebookMessage, not the WhatsApp endpoint, even with no phone number', async () => {
  const { container, root } = renderPage();
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes><Route path="/chat" element={<ChatPage />} /></Routes>
      </MemoryRouter>
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  await selectConversationAndType(container, 20, 'Hello from Messenger');
  await act(async () => { await Promise.resolve(); });

  const sendButton = Array.from(container.querySelectorAll('button')).find((button) => button.querySelector('svg[data-testid="SendRoundedIcon"]'));
  await act(async () => { sendButton?.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  expect(facebookMessengerService.sendFacebookMessage).toHaveBeenCalledWith(20, 'Hello from Messenger', expect.any(String));
  expect(chatService.sendConversationMessage).not.toHaveBeenCalled();
  expect(chatService.sendConversationTemplate).not.toHaveBeenCalled();

  await act(async () => root.unmount());
  container.remove();
});

test('a WhatsApp conversation still sends through sendConversationMessage unchanged', async () => {
  const { container, root } = renderPage();
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes><Route path="/chat" element={<ChatPage />} /></Routes>
      </MemoryRouter>
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  await selectConversationAndType(container, 10, 'Hello over WhatsApp');
  await act(async () => { await Promise.resolve(); });

  const sendButton = Array.from(container.querySelectorAll('button')).find((button) => button.querySelector('svg[data-testid="SendRoundedIcon"]'));
  await act(async () => { sendButton?.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  expect(chatService.sendConversationMessage).toHaveBeenCalledWith(10, { text: 'Hello over WhatsApp', replyToMessageId: null });
  expect(facebookMessengerService.sendFacebookMessage).not.toHaveBeenCalled();

  await act(async () => root.unmount());
  container.remove();
});

test('a Facebook send failure surfaces the Facebook endpoint\'s own error message, not a WhatsApp-worded fallback', async () => {
  facebookMessengerService.sendFacebookMessage.mockImplementation(async () => {
    throw { response: { data: { message: 'This conversation is outside the Messenger messaging window.' } } };
  });
  const { container, root } = renderPage();
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/chat']}>
        <Routes><Route path="/chat" element={<ChatPage />} /></Routes>
      </MemoryRouter>
    );
  });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  await selectConversationAndType(container, 20, 'Hello after window closed');
  await act(async () => { await Promise.resolve(); });

  const sendButton = Array.from(container.querySelectorAll('button')).find((button) => button.querySelector('svg[data-testid="SendRoundedIcon"]'));
  await act(async () => { sendButton?.click(); });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  expect(container.textContent).toContain('This conversation is outside the Messenger messaging window.');
  expect(container.textContent).not.toContain('Unable to send WhatsApp message.');

  await act(async () => root.unmount());
  container.remove();
});
