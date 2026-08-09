import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { StudentSupportTicketsPage } from './StudentPortalPages';
import * as portal from '../services/studentPortal.service';

jest.mock('../services/studentPortal.service', () => ({
  listStudentSupportTickets: jest.fn(),
  getStudentSupportCategories: jest.fn(),
  createStudentSupportTicket: jest.fn(),
  getStudentSupportTicket: jest.fn(),
  replyStudentSupportTicket: jest.fn(),
  confirmStudentSupportTicket: jest.fn()
}));

global.IS_REACT_ACT_ENVIRONMENT = true;
const response = (data) => Promise.resolve({ data: { data } });

test('renders the portal ticket page and opens the create Dialog', async () => {
  portal.listStudentSupportTickets.mockReturnValue(response({ items: [] }));
  portal.getStudentSupportCategories.mockReturnValue(response([{ id: 1, name: 'Technical problem' }]));
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<StudentSupportTicketsPage />); });
  expect(document.body.textContent).toContain('No support tickets yet');
  const createButton = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Create ticket');
  expect(createButton).toBeTruthy();
  await act(async () => { Simulate.click(createButton); });
  expect(document.body.textContent).toContain('Create support request');
  expect(document.body.textContent).toContain('Detailed description');
  await act(async () => root.unmount());
  container.remove();
});
