import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import FlowNodeConfigDialog from './FlowNodeConfigDialog';

function makeNode(config = {}) {
  return { id: 'start-1', data: { nodeType: 'start', label: 'Flow Start', config: { source: 'any_message', ...config } } };
}

function findByText(tag, text) {
  return Array.from(document.querySelectorAll(tag)).find((el) => el.textContent.trim() === text);
}

describe('Flow Builder start-node trigger priority / stop-after-match UI', () => {
  let container; let root;
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    global.IS_REACT_ACT_ENVIRONMENT = false;
  });

  function mount(node, onSave) {
    act(() => {
      root = createRoot(container);
      root.render(
        <FlowNodeConfigDialog
          node={node}
          open
          onClose={() => {}}
          onSave={onSave}
          onDelete={() => {}}
          departments={[]}
          users={[]}
          actionOptions={{}}
          flowId={1}
          whatsappAccountId={2}
        />
      );
    });
  }

  test('a flow with no priority/stopAfterMatch fields loads with the documented defaults (blank priority placeholder 100, stop-after-match checked)', () => {
    mount(makeNode(), jest.fn());
    const priorityInput = document.querySelector('input[placeholder="100"]');
    expect(priorityInput).toBeTruthy();
    expect(priorityInput.value).toBe('');
    const stopLabel = findByText('label', 'Stop after this flow matches');
    const stopCheckbox = stopLabel.querySelector('input[type="checkbox"]');
    expect(stopCheckbox.checked).toBe(true);
  });

  test('typing a priority and saving persists it as a number under triggerConfig.priority', () => {
    const onSave = jest.fn();
    mount(makeNode(), onSave);
    const priorityInput = document.querySelector('input[placeholder="100"]');
    act(() => { Simulate.change(priorityInput, { target: { value: '10' } }); });
    const saveButton = findByText('button', 'Save Changes');
    act(() => { Simulate.click(saveButton); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].config.priority).toBe(10);
  });

  test('leaving priority blank does not write a priority field at all (absent = effective default 100)', () => {
    const onSave = jest.fn();
    mount(makeNode(), onSave);
    const saveButton = findByText('button', 'Save Changes');
    act(() => { Simulate.click(saveButton); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].config).not.toHaveProperty('priority');
  });

  test('unchecking "Stop after this flow matches" saves stopAfterMatch=false', () => {
    const onSave = jest.fn();
    mount(makeNode(), onSave);
    const stopLabel = findByText('label', 'Stop after this flow matches');
    const stopCheckbox = stopLabel.querySelector('input[type="checkbox"]');
    act(() => { Simulate.change(stopCheckbox, { target: { checked: false } }); });
    const saveButton = findByText('button', 'Save Changes');
    act(() => { Simulate.click(saveButton); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].config.stopAfterMatch).toBe(false);
  });

  test('a non-integer priority is rejected before save', () => {
    const onSave = jest.fn();
    mount(makeNode(), onSave);
    const priorityInput = document.querySelector('input[placeholder="100"]');
    act(() => { Simulate.change(priorityInput, { target: { value: '10.5' } }); });
    const saveButton = findByText('button', 'Save Changes');
    act(() => { Simulate.click(saveButton); });
    expect(onSave).not.toHaveBeenCalled();
  });
});
