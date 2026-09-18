const os = require('os');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-media-execution-test-'));
process.env.FLOW_MEDIA_PRIVATE_ROOT = TEMP_ROOT;

const db = require('../src/models');
const flowService = require('../src/services/flow.service');
const facebookMessengerService = require('../src/services/facebookMessenger.service');
const facebookMediaUrlResolver = require('../src/services/facebookMediaUrlResolver.service');

after(() => { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); });

function writeFile(relativePath, content = Buffer.from([0xff, 0xd8, 0xff, 0xe0])) {
  const full = path.join(TEMP_ROOT, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

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
  facebookMessengerService.sendTextMessage = async (args) => { calls.sendTextMessage.push(args); return overrides.sendTextMessage ? overrides.sendTextMessage(args) : { id: 501, facebookMessageId: 'fbmid-text' }; };
  facebookMessengerService.sendMediaMessage = async (args) => { calls.sendMediaMessage.push(args); return overrides.sendMediaMessage ? overrides.sendMediaMessage(args) : { id: 502, facebookMessageId: 'fbmid-media' }; };
  facebookMessengerService.sendButtonMessage = async (args) => { calls.sendButtonMessage.push(args); return overrides.sendButtonMessage ? overrides.sendButtonMessage(args) : { id: 503, facebookMessageId: 'fbmid-button' }; };
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
const baseContext = { channel: 'facebook_messenger', facebookPageId: 9, conversationId: 55, flowId: 1 };

function uploadedConfig(relativePath, mimeType, extra = {}) {
  writeFile(relativePath);
  return {
    mediaLocalRef: relativePath,
    whatsappMediaId: 'wamid-shared-123',
    mediaAccountId: '2',
    mimeType,
    mediaSize: 4,
    fileName: path.basename(relativePath),
    ...extra
  };
}

// A. Existing public HTTPS URL -> Messenger send succeeds.
test('A: an existing public HTTPS image URL sends via Messenger unchanged', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = { nodeKey: 'n1', nodeType: 'image_message', label: 'Photo', configJson: { imageUrl: 'https://cdn.example.com/pic.jpg' } };
    const result = await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendMediaMessage[0].url, 'https://cdn.example.com/pic.jpg');
  } finally { fb.restore(); restoreLog(); }
});

// B. Locally uploaded Flow image -> resolves to public CRM URL -> Messenger send succeeds.
test('B: a Flow-Builder-uploaded image resolves to a public CRM URL and sends via Messenger', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const config = uploadedConfig('flow/1/photo.jpg', 'image/jpeg');
    const node = { nodeKey: 'n1', nodeType: 'image_message', label: 'Photo', configJson: config };
    const result = await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(result.sent, true);
    const sentUrl = fb.calls.sendMediaMessage[0].url;
    assert.ok(sentUrl.startsWith('https://'), 'the resolved URL must be a public HTTPS URL');
    const token = sentUrl.slice(sentUrl.lastIndexOf('/') + 1);
    const verified = facebookMediaUrlResolver.verifyPublicMediaToken(token);
    assert.equal(verified.relativePath, 'flow/1/photo.jpg');
    assert.equal(verified.mimeType, 'image/jpeg');
  } finally { fb.restore(); restoreLog(); }
});

// C. Video upload -> works.
test('C: a Flow-Builder-uploaded video resolves and sends via Messenger', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const config = uploadedConfig('flow/1/clip.mp4', 'video/mp4');
    const node = { nodeKey: 'n1', nodeType: 'video_message', label: 'Clip', configJson: config };
    const result = await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendMediaMessage[0].mediaType, 'video');
  } finally { fb.restore(); restoreLog(); }
});

// D. Audio upload -> works.
test('D: a Flow-Builder-uploaded audio file resolves and sends via Messenger', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const config = uploadedConfig('flow/1/voice.aac', 'audio/aac');
    const node = { nodeKey: 'n1', nodeType: 'audio_message', label: 'Voice', configJson: config };
    const result = await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendMediaMessage[0].mediaType, 'audio');
  } finally { fb.restore(); restoreLog(); }
});

// E. File upload -> works.
test('E: a Flow-Builder-uploaded document resolves and sends via Messenger', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const config = uploadedConfig('flow/1/brochure.pdf', 'application/pdf');
    const node = { nodeKey: 'n1', nodeType: 'file_document', label: 'Brochure', configJson: config };
    const result = await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendMediaMessage[0].mediaType, 'document');
  } finally { fb.restore(); restoreLog(); }
});

// F. WhatsApp path remains unchanged: the same node config, executed against
// a WhatsApp-channel context, never touches the Facebook resolver/adapter at
// all — it fails on the pre-existing, untouched WhatsApp account guard.
test('F: the same uploaded media node on a WhatsApp-channel run never calls the Facebook adapter', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const config = uploadedConfig('flow/1/whatsapp-only.jpg', 'image/jpeg');
    const node = { nodeKey: 'n1', nodeType: 'image_message', label: 'Photo', configJson: config };
    await assert.rejects(
      flowService.executeNode({ run: baseRun, node, context: {}, realSendEnabled: true }),
      (error) => error.code === 'WHATSAPP_ACCOUNT_MISMATCH'
    );
    assert.equal(fb.calls.sendMediaMessage.length, 0, 'the Facebook adapter must never be called for a WhatsApp-channel run');
  } finally { fb.restore(); restoreLog(); }
});

// G. Multi-channel: the exact same uploaded media node config (one upload)
// is reused for a Facebook Messenger send without any special-casing or
// duplicate upload, and resolving it for Messenger never mutates the
// WhatsApp-facing fields (whatsappMediaId/mediaAccountId) the WhatsApp path
// still depends on.
test('G: a single uploaded media node config is reused for Messenger without touching its WhatsApp fields', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const config = uploadedConfig('flow/1/shared.jpg', 'image/jpeg');
    const node = { nodeKey: 'n1', nodeType: 'image_message', label: 'Photo', configJson: { ...config } };
    await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    await flowService.executeNode({ run: baseRun, node, context: { ...baseContext, conversationId: 56 }, realSendEnabled: true });
    assert.equal(fb.calls.sendMediaMessage.length, 2, 'the same node config must resolve and send successfully every time, not just once');
    assert.equal(node.configJson.whatsappMediaId, 'wamid-shared-123', 'the WhatsApp media ID must be untouched by Messenger resolution');
    assert.equal(node.configJson.mediaAccountId, '2', 'the WhatsApp account binding must be untouched by Messenger resolution');
  } finally { fb.restore(); restoreLog(); }
});

// L. Existing Facebook text node still works (no regression from the media changes).
test('L: a text_message node on Messenger still sends exactly as before', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = { nodeKey: 'n1', nodeType: 'text_message', label: 'Greeting', configJson: { message: 'Hello!' } };
    const result = await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendTextMessage[0].text, 'Hello!');
    assert.equal(fb.calls.sendMediaMessage.length, 0);
  } finally { fb.restore(); restoreLog(); }
});

// M. Flow continues to the next node after a successful Messenger media send.
test('M: after a successful Messenger media send, the flow continues to the next node', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  const originalFlowNodeUpdate = db.FlowNode.update;
  db.FlowNode.update = async () => [1];
  const originalConversationFindByPk = db.Conversation.findByPk;
  const conversation = { id: 55, facebookPageId: 9, toJSON: () => ({ id: 55, facebookPageId: 9 }), async update() {} };
  db.Conversation.findByPk = async () => conversation;
  const originalFlowRunCreate = db.FlowRun.create;
  const flowRunsCreated = [];
  db.FlowRun.create = async (data) => { const run = { id: 1000, ...data, async update(patch) { Object.assign(run, patch); return run; } }; flowRunsCreated.push(run); return run; };
  const originalFlowRunFindByPk = db.FlowRun.findByPk;
  db.FlowRun.findByPk = async (id) => flowRunsCreated.find((run) => run.id === Number(id)) || null;
  const originalFlowRunLinkFindOne = db.FlowRunLink.findOne;
  db.FlowRunLink.findOne = async () => null;
  try {
    const config = uploadedConfig('flow/1/continue.jpg', 'image/jpeg');
    const flow = {
      id: 1,
      nodes: [
        { nodeKey: 'start', nodeType: 'start', label: 'Start', configJson: {} },
        { nodeKey: 'media', nodeType: 'image_message', label: 'Photo', configJson: config },
        { nodeKey: 'after', nodeType: 'text_message', label: 'Thanks', configJson: { message: 'Thanks for viewing!' } }
      ],
      connections: [
        { sourceNodeKey: 'start', targetNodeKey: 'media' },
        { sourceNodeKey: 'media', targetNodeKey: 'after' }
      ]
    };
    const context = { channel: 'facebook_messenger', facebookPageId: 9, conversationId: 55, flowId: 1 };
    await flowService.executeFlow(flow, context, {});
    assert.equal(fb.calls.sendMediaMessage.length, 1, 'the media node must send successfully');
    assert.equal(fb.calls.sendTextMessage.length, 1, 'execution must continue to the node after the media node');
    assert.equal(fb.calls.sendTextMessage[0].text, 'Thanks for viewing!');
    assert.equal(flowRunsCreated[0].status, 'completed', 'the run must complete, not stop or fail, after the media node');
  } finally {
    fb.restore(); restoreLog();
    db.FlowNode.update = originalFlowNodeUpdate;
    db.Conversation.findByPk = originalConversationFindByPk;
    db.FlowRun.create = originalFlowRunCreate;
    db.FlowRun.findByPk = originalFlowRunFindByPk;
    db.FlowRunLink.findOne = originalFlowRunLinkFindOne;
  }
});

// A media node failure must not be silently treated as sent, and must not
// stop the run from being marked failed the same way any other node failure
// would (unchanged failure semantics).
test('a failing media resolution marks the node/run failed, never silently "sent"', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = { nodeKey: 'n1', nodeType: 'image_message', label: 'Photo', configJson: { mediaLocalRef: 'flow/1/never-written.jpg', mimeType: 'image/jpeg' } };
    await assert.rejects(
      flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true }),
      (error) => error.code === 'FACEBOOK_MEDIA_FILE_MISSING'
    );
    assert.equal(fb.calls.sendMediaMessage.length, 0, 'a failed resolution must never reach the actual send call');
  } finally { fb.restore(); restoreLog(); }
});

// ---------------------------------------------------------------------------
// Interactive Message / Button header media — now resolved through the exact
// same facebookMediaUrlResolver.service.js as standalone media nodes.
// ---------------------------------------------------------------------------

function interactiveHeaderNode(headerConfig, buttons = [{ id: 'yes', title: 'Yes' }]) {
  return {
    nodeKey: 'n1', nodeType: 'button_message', label: 'Choose',
    configJson: { message: 'Pick one', buttons, ...headerConfig }
  };
}

// A. Interactive header existing HTTPS image works.
test('A(header): an existing public HTTPS header image is sent before the button template', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = interactiveHeaderNode({ headerType: 'media', headerMediaType: 'image', headerMediaUrl: 'https://cdn.example.com/header.jpg' });
    const result = await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendMediaMessage.length, 1);
    assert.equal(fb.calls.sendMediaMessage[0].url, 'https://cdn.example.com/header.jpg');
    assert.equal(fb.calls.sendButtonMessage.length, 1, 'the button template must still follow the header');
  } finally { fb.restore(); restoreLog(); }
});

// B. Locally uploaded interactive header image resolves and sends.
test('B(header): a Flow-Builder-uploaded header image resolves to a public CRM URL and sends', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    writeFile('flow/1/header-photo.jpg');
    const node = interactiveHeaderNode({
      headerType: 'media', headerMediaType: 'image',
      headerMediaUrl: '', headerMediaLocalRef: 'flow/1/header-photo.jpg', headerMediaMimeType: 'image/jpeg',
      headerMediaId: 'wamid-header-1', headerMediaAccountId: '2'
    });
    const result = await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendMediaMessage.length, 1);
    const sentUrl = fb.calls.sendMediaMessage[0].url;
    assert.ok(sentUrl.startsWith('https://'));
    const token = sentUrl.slice(sentUrl.lastIndexOf('/') + 1);
    const verified = facebookMediaUrlResolver.verifyPublicMediaToken(token);
    assert.equal(verified.relativePath, 'flow/1/header-photo.jpg');
    assert.equal(verified.mimeType, 'image/jpeg');
    assert.equal(fb.calls.sendButtonMessage.length, 1);
  } finally { fb.restore(); restoreLog(); }
});

// C. Locally uploaded supported video header resolves correctly.
test('C(header): a Flow-Builder-uploaded header video resolves and sends', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    writeFile('flow/1/header-clip.mp4');
    const node = interactiveHeaderNode({
      headerType: 'media', headerMediaType: 'video',
      headerMediaLocalRef: 'flow/1/header-clip.mp4', headerMediaMimeType: 'video/mp4'
    });
    const result = await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendMediaMessage[0].mediaType, 'video');
  } finally { fb.restore(); restoreLog(); }
});

test('C2(header): a Flow-Builder-uploaded header document resolves and sends', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    writeFile('flow/1/header-brochure.pdf');
    const node = interactiveHeaderNode({
      headerType: 'media', headerMediaType: 'document',
      headerMediaLocalRef: 'flow/1/header-brochure.pdf', headerMediaMimeType: 'application/pdf'
    });
    const result = await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendMediaMessage[0].mediaType, 'document');
  } finally { fb.restore(); restoreLog(); }
});

// D. Invalid/missing configured header media does not silently disappear.
test('D(header): a configured but unresolvable header (missing local file) fails loudly instead of being silently dropped', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = interactiveHeaderNode({
      headerType: 'media', headerMediaType: 'image',
      headerMediaLocalRef: 'flow/1/never-written-header.jpg', headerMediaMimeType: 'image/jpeg'
    });
    await assert.rejects(
      flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true }),
      (error) => error.code === 'FACEBOOK_MEDIA_FILE_MISSING'
    );
    assert.equal(fb.calls.sendMediaMessage.length, 0);
    assert.equal(fb.calls.sendButtonMessage.length, 0, 'the button template must not be sent either — the whole node fails, not a partial send');
  } finally { fb.restore(); restoreLog(); }
});

test('D2(header): a "media" header with nothing ever attached is not an error — there is nothing configured to discard', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = interactiveHeaderNode({ headerType: 'media', headerMediaType: 'image' });
    const result = await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendMediaMessage.length, 0, 'nothing was ever configured, so nothing is sent — this is not the same as discarding configured media');
    assert.equal(fb.calls.sendButtonMessage.length, 1);
  } finally { fb.restore(); restoreLog(); }
});

// E. Buttons/postback payloads remain unchanged.
test('E(header): button postback payload encoding is unaffected by header media resolution', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = interactiveHeaderNode(
      { headerType: 'media', headerMediaType: 'image', headerMediaUrl: 'https://cdn.example.com/header.jpg' },
      [{ id: 'yes', title: 'Yes' }, { id: 'no', title: 'No' }]
    );
    await flowService.executeNode({ run: baseRun, node: { ...node, nodeKey: 'n42' }, context: { ...baseContext, flowId: 42 }, realSendEnabled: true });
    const sentButtons = fb.calls.sendButtonMessage[0].buttons;
    assert.equal(sentButtons[0].id, 'flowbtn:42:n42:yes');
    assert.equal(sentButtons[1].id, 'flowbtn:42:n42:no');
  } finally { fb.restore(); restoreLog(); }
});

// F. Text-only interactive message remains unchanged (no header at all).
test('F(header): a text-only interactive/button node never calls sendMediaMessage', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = interactiveHeaderNode({ headerType: 'text', headerText: 'Header text' });
    const result = await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(result.sent, true);
    assert.equal(fb.calls.sendMediaMessage.length, 0);
    assert.equal(fb.calls.sendButtonMessage[0].text.startsWith('Header text'), true);
  } finally { fb.restore(); restoreLog(); }
});

// H. Multi-channel: the same uploaded header media config works for Messenger
// without touching the WhatsApp-facing fields the WhatsApp interactive header
// path (interactiveMediaService.resolveHeader) still depends on.
test('H(header): a single uploaded header media config is reused for Messenger without mutating its WhatsApp fields', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    writeFile('flow/1/shared-header.jpg');
    const headerConfig = {
      headerType: 'media', headerMediaType: 'image',
      headerMediaLocalRef: 'flow/1/shared-header.jpg', headerMediaMimeType: 'image/jpeg',
      headerMediaId: 'wamid-shared-header', headerMediaAccountId: '2'
    };
    const node = interactiveHeaderNode({ ...headerConfig });
    await flowService.executeNode({ run: baseRun, node, context: baseContext, realSendEnabled: true });
    assert.equal(fb.calls.sendMediaMessage.length, 1);
    assert.equal(node.configJson.headerMediaId, 'wamid-shared-header', 'the WhatsApp header media ID must be untouched');
    assert.equal(node.configJson.headerMediaAccountId, '2', 'the WhatsApp account binding must be untouched');
  } finally { fb.restore(); restoreLog(); }
});

// G. WhatsApp interactive message path remains unchanged — this node type
// never reaches the Facebook adapter at all for a WhatsApp-channel run.
test('G(header): a button_message node with a media header on a WhatsApp-channel run never calls the Facebook adapter', async () => {
  const restoreLog = patchLog();
  const fb = patchFacebookSend();
  try {
    const node = interactiveHeaderNode({ headerType: 'media', headerMediaType: 'image', headerMediaUrl: 'https://cdn.example.com/header.jpg' });
    await assert.rejects(
      flowService.executeNode({ run: baseRun, node, context: {}, realSendEnabled: true }),
      (error) => error.code === 'WHATSAPP_ACCOUNT_MISMATCH'
    );
    assert.equal(fb.calls.sendMediaMessage.length, 0);
    assert.equal(fb.calls.sendButtonMessage.length, 0);
  } finally { fb.restore(); restoreLog(); }
});
