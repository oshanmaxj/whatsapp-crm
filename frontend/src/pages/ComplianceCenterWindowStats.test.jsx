import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ComplianceCenterPage from './ComplianceCenterPage';
import * as templateService from '../services/whatsappTemplate.service';

jest.mock('../services/whatsappTemplate.service', () => ({
  getWhatsAppComplianceStatus: jest.fn(),
  checkWhatsAppMessage: jest.fn(),
  getWhatsAppWindowStats: jest.fn()
}));
jest.mock('../components/WhatsAppAccountSelect', () => function FakeSelect({ value, onChange }) {
  return (
    <select data-testid="account-select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">All WhatsApp numbers</option>
      <option value="7">Main Line · +1 555 0100</option>
    </select>
  );
});

global.IS_REACT_ACT_ENVIRONMENT = true;
const response = (data) => Promise.resolve({ data: { data } });

function renderPage() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

test('renders the 24H and 72H blocks as clearly separate stat sections with correct labels and counts', async () => {
  templateService.getWhatsAppComplianceStatus.mockReturnValue(response({ qualityRatings: [], logs: [] }));
  templateService.getWhatsAppWindowStats.mockReturnValue(response({
    scope: 'all',
    serviceWindow24h: { activeConversations: 12, expiredConversations: 4, messages: { sent: 50, delivered: 45, read: 30, failed: 2 } },
    freeEntryWindow72h: { activeConversations: 3, expiredConversations: 1, messages: { sent: 9, delivered: 8, read: 5, failed: 0 } },
    uniqueActiveCustomers: 14,
    pricing: { confirmedFree: 20, confirmedBillable: 10, unknown: 25 }
  }));

  const { container, root } = renderPage();
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/compliance']}>
        <Routes>
          <Route path="/compliance" element={<ComplianceCenterPage />} />
        </Routes>
      </MemoryRouter>
    );
  });
  await act(async () => { await Promise.resolve(); });

  const text = container.textContent;
  expect(text).toContain('24H Customer Service Window');
  expect(text).toContain('72H Free Entry Point Window');
  expect(text).toContain('12'); // 24h active conversations
  expect(text).toContain('3'); // 72h active conversations
  expect(text).toContain('14 unique customers with an active window');
  expect(text).toContain('Confirmed free: 20');
  expect(text).toContain('Confirmed billable: 10');
  expect(text).toContain('Unknown: 25');

  await act(async () => root.unmount());
  container.remove();
});

test('selecting a specific WhatsApp number refetches window stats scoped to that account', async () => {
  templateService.getWhatsAppComplianceStatus.mockReturnValue(response({ qualityRatings: [], logs: [] }));
  templateService.getWhatsAppWindowStats.mockReturnValue(response({
    scope: 'all', serviceWindow24h: { activeConversations: 0, expiredConversations: 0, messages: {} },
    freeEntryWindow72h: { activeConversations: 0, expiredConversations: 0, messages: {} },
    uniqueActiveCustomers: 0, pricing: {}
  }));

  const { container, root } = renderPage();
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/compliance']}>
        <Routes>
          <Route path="/compliance" element={<ComplianceCenterPage />} />
        </Routes>
      </MemoryRouter>
    );
  });
  await act(async () => { await Promise.resolve(); });

  expect(templateService.getWhatsAppWindowStats).toHaveBeenCalledWith(null);

  const select = container.querySelector('[data-testid="account-select"]');
  await act(async () => {
    select.value = '7';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });

  expect(templateService.getWhatsAppWindowStats).toHaveBeenCalledWith('7');

  await act(async () => root.unmount());
  container.remove();
});
