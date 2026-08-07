import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { MessageComposer } from './ChatArea';
import { sendConversationTyping } from '../../services/chat.service';

jest.mock('../../services/chat.service', () => ({ sendConversationTyping: jest.fn(() => Promise.resolve()) }));

function Harness() {
  const [value, setValue] = useState('');
  return <MessageComposer
    value={value} onChange={setValue} onSend={() => {}} onSendInteractive={() => {}}
    onAttach={() => {}} onSendVoice={() => {}} onSaveTemplate={() => {}}
    quickReplies={[]} whatsappTemplates={[]} selectedTemplate={null} templateDiagnostics={null}
    onSelectTemplate={() => {}} windowOpen selected sending={false} replyToMessage={null}
    onCancelReply={() => {}} conversation={{ id: 42, whatsappAccountId: 9 }}
  />;
}

describe('manual WhatsApp typing indicator', () => {
  let container; let root;
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    jest.useFakeTimers();
    sendConversationTyping.mockReset().mockResolvedValue({ data: { data: { status: 'sent' } } });
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => { root = createRoot(container); root.render(<Harness />); });
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    global.IS_REACT_ACT_ENVIRONMENT = false;
  });

  test('debounces the first request, renews at 20 seconds, and stops on blur or empty input', () => {
    const input = container.querySelector('textarea');
    act(() => { Simulate.focus(input); Simulate.change(input, { target: { value: 'Hello' } }); });
    act(() => jest.advanceTimersByTime(399));
    expect(sendConversationTyping).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(sendConversationTyping).toHaveBeenCalledTimes(1);
    expect(sendConversationTyping).toHaveBeenLastCalledWith(42);
    act(() => jest.advanceTimersByTime(20_000));
    expect(sendConversationTyping).toHaveBeenCalledTimes(2);

    act(() => Simulate.blur(input));
    act(() => jest.advanceTimersByTime(40_000));
    expect(sendConversationTyping).toHaveBeenCalledTimes(2);

    act(() => { Simulate.focus(input); Simulate.change(input, { target: { value: '' } }); });
    act(() => jest.advanceTimersByTime(21_000));
    expect(sendConversationTyping).toHaveBeenCalledTimes(2);
  });
});
