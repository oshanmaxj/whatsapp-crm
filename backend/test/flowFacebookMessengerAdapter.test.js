const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const flowService = require('../src/services/flow.service');
const facebookMessengerService = require('../src/services/facebookMessenger.service');

function patchLog() {
  const original = db.FlowRunLog.create;
  db.FlowRunLog.create = async () => ({});
  return () => { db.FlowRunLog.create = original; };
}

function patchFacebookSend(overrides = {}) {
  const originals = {
    sendTextMessage: facebookMessengerService.sendTextMessage,
    sendMediaMessage: facebookMessengerService.sendMediaMessage,
    sendButtonMessage: facebookMessengerService.sendButtonMessage
  };
  const calls = { sendTextMessage: [], sendMediaMessage: [], sendButtonMessage: [] };
  facebookMessengerService.sendTextMessage = async (args) => { calls.sendTextMessage.push(args); return overrides.sendTextMessage ? overrides.sendTextMessage(args) : { id: 501, facebookMessageId: 'fbmid-1' }; };
  facebookMessengerService.sendMediaMessage = async (args) => { calls.sendMediaMessage.push(args); return overrides.sendMediaMessage ? overrides.sendMediaMessage(args) : { id: 502, facebookMessageId: 'fbmid-2' }; };
  facebookMessengerService.sendButtonMessage = async (args) => { calls.sendButtonMessage.push(args); return overrides.sendButtonMessage ? overrides.sendButtonMessage(args) : { id: 503, facebookMessageId: 'fbmid-3' }; };
  return {
    calls,
    restore() {
      facebookMessengerService.sendTextMessage = originals.sendTextMessage;
      facebookMessengerService.sendMediaMessage = originals.sendMediaMessage;
      facebookMessengerService.sendButtonMessage = originals.sendButtonMessage;
    }
  };
}

const baseRun = { id: 900 };

// 5. Messenger text node uses the Facebook adapter, not whatsappService.
test('scenario 5: a text_message node on a Facebook Messenger run sends through facebookMessenger.service, not WhatsApp', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = { nodeKey: 'n1', nodeType: 'text_message', label: 'Greeting', configJson: { message: 'Hello {{contact.firstName}}' } };
    const context = { channel: 'facebook_messenger', facebookPageId: 9, conversationId: 55, flowId: 1, contact: { firstName: 'Sam' } };
    const result = await flowService.executeNode({ run: baseRun, node, context, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendTextMessage.length, 1);
    assert.equal(fb.calls.sendTextMessage[0].conversationId, 55);
    assert.equal(fb.calls.sendTextMessage[0].text, 'Hello Sam');
    assert.equal(fb.calls.sendMediaMessage.length, 0);
    assert.equal(fb.calls.sendButtonMessage.length, 0);
  } finally { fb.restore(); restoreLog(); }
});

// 6. Messenger media nodes use the Facebook adapter.
test('scenario 6: image_message, video_message, audio_message and file_document nodes route through facebookMessenger.service.sendMediaMessage', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const cases = [
      { nodeType: 'image_message', config: { imageUrl: 'https://cdn.example.com/pic.jpg' }, expectedType: 'image' },
      { nodeType: 'video_message', config: { mediaUrl: 'https://cdn.example.com/clip.mp4' }, expectedType: 'video' },
      { nodeType: 'audio_message', config: { mediaUrl: 'https://cdn.example.com/voice.mp3' }, expectedType: 'audio' },
      { nodeType: 'file_document', config: { fileUrl: 'https://cdn.example.com/brochure.pdf' }, expectedType: 'document' }
    ];
    for (const testCase of cases) {
      const node = { nodeKey: `n-${testCase.nodeType}`, nodeType: testCase.nodeType, label: 'Media', configJson: testCase.config };
      const context = { channel: 'facebook_messenger', facebookPageId: 9, conversationId: 55, flowId: 1 };
      const result = await flowService.executeNode({ run: baseRun, node, context, realSendEnabled: true });
      assert.equal(result.sent, true, `${testCase.nodeType} should report sent`);
    }
    assert.equal(fb.calls.sendMediaMessage.length, 4);
    assert.deepEqual(fb.calls.sendMediaMessage.map((call) => call.mediaType), ['image', 'video', 'audio', 'document']);
    assert.equal(fb.calls.sendTextMessage.length, 0);
  } finally { fb.restore(); restoreLog(); }
});

test('a Facebook Messenger media node rejects a data: URL with a clear error instead of silently failing', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = { nodeKey: 'n1', nodeType: 'image_message', label: 'Media', configJson: { imageUrl: 'data:image/png;base64,aaaa' } };
    const context = { channel: 'facebook_messenger', facebookPageId: 9, conversationId: 55, flowId: 1 };
    await assert.rejects(
      flowService.executeNode({ run: baseRun, node, context, realSendEnabled: true }),
      (error) => error.code === 'FACEBOOK_MEDIA_URL_REQUIRED'
    );
    assert.equal(fb.calls.sendMediaMessage.length, 0);
  } finally { fb.restore(); restoreLog(); }
});

// 7 (send side). Interactive buttons map to Messenger's button template with
// the same encodedButtonId payload WhatsApp uses, so postbacks decode back
// into the same flow/node/button.
test('scenario 7 (send side): a button_message node sends a Messenger button template with encoded postback payloads', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = { nodeKey: 'n1', nodeType: 'button_message', label: 'Choose', configJson: { message: 'Pick one', buttons: [{ id: 'yes', title: 'Yes' }, { id: 'no', title: 'No' }] } };
    const context = { channel: 'facebook_messenger', facebookPageId: 9, conversationId: 55, flowId: 42 };
    const result = await flowService.executeNode({ run: baseRun, node, context, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendButtonMessage.length, 1);
    const sentButtons = fb.calls.sendButtonMessage[0].buttons;
    assert.equal(sentButtons.length, 2);
    assert.equal(sentButtons[0].id, 'flowbtn:42:n1:yes');
    assert.equal(sentButtons[1].id, 'flowbtn:42:n1:no');
  } finally { fb.restore(); restoreLog(); }
});

test('a button_message node with a media header sends the media separately before the Messenger button template', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = {
      nodeKey: 'n1', nodeType: 'button_message', label: 'Choose',
      configJson: { message: 'Pick one', headerType: 'media', headerMediaType: 'image', headerMediaUrl: 'https://cdn.example.com/header.jpg', buttons: [{ id: 'yes', title: 'Yes' }] }
    };
    const context = { channel: 'facebook_messenger', facebookPageId: 9, conversationId: 55, flowId: 42 };
    await flowService.executeNode({ run: baseRun, node, context, realSendEnabled: true });
    assert.equal(fb.calls.sendMediaMessage.length, 1, 'the header image must be sent as its own message first');
    assert.equal(fb.calls.sendMediaMessage[0].mediaType, 'image');
    assert.equal(fb.calls.sendButtonMessage.length, 1, 'the button template follows the header media');
  } finally { fb.restore(); restoreLog(); }
});

// 8 (runtime half). Unsupported nodes fail with a defined error instead of a
// silent WhatsApp-shaped attempt against Messenger's API.
test('scenario 8 (runtime): a location node on a Facebook Messenger run fails with FLOW_NODE_UNSUPPORTED_FOR_CHANNEL, not a WhatsApp API call', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = { nodeKey: 'n1', nodeType: 'location', label: 'Share office', configJson: { latitude: 1, longitude: 1 } };
    const context = { channel: 'facebook_messenger', facebookPageId: 9, conversationId: 55, flowId: 1 };
    await assert.rejects(
      flowService.executeNode({ run: baseRun, node, context, realSendEnabled: true }),
      (error) => error.code === 'FLOW_NODE_UNSUPPORTED_FOR_CHANNEL' && error.channel === 'facebook_messenger' && error.nodeType === 'location'
    );
    assert.equal(fb.calls.sendTextMessage.length, 0);
    assert.equal(fb.calls.sendMediaMessage.length, 0);
  } finally { fb.restore(); restoreLog(); }
});

test('scenario 8 (runtime): whatsapp_flow, list_message, and appointment_booking are also rejected for Facebook Messenger', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    for (const nodeType of ['whatsapp_flow', 'list_message', 'appointment_booking']) {
      const node = { nodeKey: `n-${nodeType}`, nodeType, label: 'Unsupported', configJson: {} };
      const context = { channel: 'facebook_messenger', facebookPageId: 9, conversationId: 55, flowId: 1 };
      await assert.rejects(
        flowService.executeNode({ run: baseRun, node, context, realSendEnabled: true }),
        (error) => error.code === 'FLOW_NODE_UNSUPPORTED_FOR_CHANNEL',
        `${nodeType} should be rejected`
      );
    }
  } finally { fb.restore(); restoreLog(); }
});

test('a Facebook comment channel run also rejects location the same way', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = { nodeKey: 'n1', nodeType: 'location', label: 'Share office', configJson: {} };
    const context = { channel: 'facebook_comment', facebookPageId: 9, conversationId: 55, flowId: 1 };
    await assert.rejects(
      flowService.executeNode({ run: baseRun, node, context, realSendEnabled: true }),
      (error) => error.code === 'FLOW_NODE_UNSUPPORTED_FOR_CHANNEL'
    );
  } finally { fb.restore(); restoreLog(); }
});

// 18 (dispatch half). A WhatsApp-channel run never reaches the Facebook adapter.
test('scenario 18: a text_message node with no Facebook channel context never calls facebookMessenger.service', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = { nodeKey: 'n1', nodeType: 'text_message', label: 'Hi', configJson: { message: 'Hello' } };
    // No context.channel (defaults to 'whatsapp') and no whatsappAccountId/conversationId
    // configured — the WhatsApp path is expected to throw its own guard error,
    // but it must be THAT error, never a Facebook adapter call.
    await assert.rejects(
      flowService.executeNode({ run: baseRun, node, context: {}, realSendEnabled: true }),
      (error) => error.code === 'WHATSAPP_ACCOUNT_MISMATCH'
    );
    assert.equal(fb.calls.sendTextMessage.length, 0);
    assert.equal(fb.calls.sendMediaMessage.length, 0);
    assert.equal(fb.calls.sendButtonMessage.length, 0);
  } finally { fb.restore(); restoreLog(); }
});
