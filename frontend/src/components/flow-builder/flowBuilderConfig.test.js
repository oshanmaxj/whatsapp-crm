import { applyInteractiveMediaUpload, buttonActionFields, compatibleButton, nodeConfigErrors, normalizeKeywords } from './flowBuilderConfig';

test('button action types expose only relevant fields', () => {
  expect(buttonActionFields('SEND_MESSAGE')).toEqual(['message']);
  expect(buttonActionFields('START_FLOW')).toContain('targetFlowId');
  expect(buttonActionFields('OPEN_URL')).toEqual(['url']);
  expect(buttonActionFields('CALL_PHONE')).toEqual(['phone']);
  expect(buttonActionFields('CONTINUE_FLOW')).toEqual([]);
});

test('multi-select action values save and reload as stable arrays', () => {
  const button = compatibleButton({ id: 'stable', title: 'Choose', automationActions: [{ actionType: 'ADD_LABELS', config: { labelIds: [2, 4] } }] });
  expect(JSON.parse(JSON.stringify(button)).automationActions[0].config.labelIds).toEqual([2, 4]);
});

test('legacy button definitions load without data loss', () => {
  const legacy = { id: 'visit', title: 'Visit', actionType: 'url', url: 'https://example.com', extraLegacyValue: 'keep' };
  const normalized = compatibleButton(legacy);
  expect(normalized.id).toBe('visit');
  expect(normalized.extraLegacyValue).toBe('keep');
  expect(normalized.primaryActionType).toBe('OPEN_URL');
  expect(normalized.primaryActionConfig.url).toBe(legacy.url);
});

test('advanced trigger and action validation supports Unicode and required action fields', () => {
  expect(normalizeKeywords(' ආයුබෝවන් , HELLO ')).toEqual(['ආයුබෝවන්', 'HELLO']);
  const errors = nodeConfigErrors('button_message', { message: 'Choose', buttons: [{ id: 'b1', title: 'Go', primaryActionType: 'START_FLOW', primaryActionConfig: {} }] });
  expect(errors.button_0_value).toMatch(/published flow/i);
});

test('interactive media headers require a valid uploaded or pending source', () => {
  expect(nodeConfigErrors('interactive_message', { message: 'Choose', headerType: 'image', buttons: [{ id: 'b', title: 'Go' }] }).headerMedia).toMatch(/select/i);
  expect(nodeConfigErrors('interactive_message', { message: 'Choose', headerType: 'image', headerMediaId: 'meta-1', headerMediaAccountId: 7, headerMediaMimeType: 'image/jpeg', headerMediaSize: 1024, buttons: [{ id: 'b', title: 'Go' }] }).headerMedia).toBeUndefined();
});

test('node save applies the successful multipart upload result and removes embedded base64', () => {
  const saved = applyInteractiveMediaUpload({ message: 'Choose', headerMediaDataBase64: 'large-base64', headerMediaPreview: 'data:image/jpeg;base64,large-base64' }, {
    mediaId: 'meta-1234', whatsappAccountId: '7', localMediaRef: 'flow/22/header.jpg',
    mimeType: 'image/jpeg', fileName: 'header.jpg', size: 1024
  }, 'image');
  expect(saved.headerMediaId).toBe('meta-1234');
  expect(saved.headerMediaAccountId).toBe('7');
  expect(saved.headerMediaDataBase64).toBe('');
  expect(saved.headerMediaPreview).toBe('');
});
