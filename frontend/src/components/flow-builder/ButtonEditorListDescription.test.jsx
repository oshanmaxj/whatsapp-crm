import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ButtonEditor } from './FlowNodeConfigDialog';

global.IS_REACT_ACT_ENVIRONMENT = true;

test('list_message row editor (mode="list") shows an optional Description field for carousel/list options', async () => {
  const rows = [{ id: 'a', title: 'Option A', primaryActionType: 'CONTINUE_FLOW' }];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ButtonEditor value={rows} onChange={() => {}} mode="list" />); });
  const descriptionField = [...container.querySelectorAll('label')].find((node) => node.textContent.includes('Description (optional)'));
  expect(descriptionField).toBeTruthy();
  await act(async () => root.unmount());
  container.remove();
});

test('button_message row editor (default mode) does not show a Description field', async () => {
  const rows = [{ id: 'a', title: 'Option A', primaryActionType: 'CONTINUE_FLOW' }];
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(<ButtonEditor value={rows} onChange={() => {}} />); });
  const descriptionField = [...container.querySelectorAll('label')].find((node) => node.textContent.includes('Description (optional)'));
  expect(descriptionField).toBeFalsy();
  await act(async () => root.unmount());
  container.remove();
});
