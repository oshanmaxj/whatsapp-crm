import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountingDashboardPage, AccountingReportsPage, AccountingTransactionsPage } from './AccountingPages';

const token = payload => `x.${btoa(JSON.stringify(payload))}.x`;
let consoleError;
beforeAll(() => { consoleError = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterAll(() => consoleError.mockRestore());
afterEach(() => localStorage.clear());

test('only system administrators see Accounting reset and historical period controls', () => {
  localStorage.setItem('accessToken', token({ isSystemAdmin: false, permissions: ['accounting.view'] }));
  expect(renderToStaticMarkup(<AccountingDashboardPage />)).not.toContain('Reset accounting reporting');
  expect(renderToStaticMarkup(<AccountingReportsPage />)).not.toContain('Accounting period');

  localStorage.setItem('accessToken', token({ isSystemAdmin: true, permissions: [] }));
  expect(renderToStaticMarkup(<AccountingDashboardPage />)).toContain('Reset accounting reporting');
  expect(renderToStaticMarkup(<AccountingReportsPage />)).toContain('Accounting period');
  expect(renderToStaticMarkup(<AccountingTransactionsPage type="income" />)).toContain('Current accounting period');
});
