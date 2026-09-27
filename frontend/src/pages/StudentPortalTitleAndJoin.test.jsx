import React, { act } from 'react';
import { Simulate } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { StudentPortalLayout, StudentLiveClassesPage } from './StudentPortalPages';
import * as portal from '../services/studentPortal.service';

jest.mock('../services/studentPortal.service', () => ({
  getStudentLiveClasses: jest.fn(),
  joinStudentLiveClass: jest.fn()
}));

global.IS_REACT_ACT_ENVIRONMENT = true;
const response = (data) => Promise.resolve({ data: { data } });

test('student portal layout sets the browser tab title and restores the previous one on unmount', async () => {
  document.title = 'WhatsApp CRM Admin';
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/student/dashboard']}>
        <Routes>
          <Route path="/student" element={<StudentPortalLayout />}>
            <Route path="dashboard" element={<div>Dashboard content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  });
  expect(document.title).toBe('Student Portal');
  await act(async () => root.unmount());
  expect(document.title).toBe('WhatsApp CRM Admin');
  container.remove();
});

test('JoinButton disables itself while joining and offers a fallback link when the meeting popup is blocked', async () => {
  const lesson = {
    id: 42, hasLiveClass: true, canJoin: true, joinButtonLabel: 'Join Live Class',
    title: 'Live Class', liveClassAt: new Date().toISOString(), course: { name: 'Course' }, batch: { name: 'Batch' }
  };
  let resolveJoin;
  portal.getStudentLiveClasses.mockReturnValue(response([lesson]));
  portal.joinStudentLiveClass.mockReturnValue(new Promise((resolve) => { resolveJoin = resolve; }));
  const originalOpen = window.open;
  // Simulates a browser-blocked popup: window.open() returns null instead of throwing.
  window.open = jest.fn(() => null);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<StudentLiveClassesPage />); });

  const joinButton = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Join Live Class');
  expect(joinButton).toBeTruthy();
  expect(joinButton.disabled).toBe(false);

  await act(async () => { Simulate.click(joinButton); });
  expect(portal.joinStudentLiveClass).toHaveBeenCalledWith(42);
  // Busy state prevents a double-submit while the request is in flight.
  expect(joinButton.textContent).toBe('Joining…');
  expect(joinButton.disabled).toBe(true);

  await act(async () => {
    resolveJoin({ data: { data: { liveClassUrl: 'https://zoom.example/j/1' } } });
    await Promise.resolve();
  });
  expect(document.body.textContent).toContain('Your browser blocked the meeting popup');
  const fallbackLink = [...container.querySelectorAll('a')].find((node) => node.href === 'https://zoom.example/j/1');
  expect(fallbackLink).toBeTruthy();

  window.open = originalOpen;
  await act(async () => root.unmount());
  container.remove();
});
