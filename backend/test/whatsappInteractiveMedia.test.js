const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const axios = require('axios');
const logger = require('../src/config/logger');
const whatsappService = require('../src/services/whatsapp.service');
const { buildInteractivePayload } = whatsappService;
const { InteractiveMediaService, validateMedia, safeFilename } = require('../src/services/interactiveMedia.service');
const flowService = require('../src/services/flow.service');
const interactiveMediaService = require('../src/services/interactiveMedia.service');
const outboundHistoryService = require('../src/services/outboundHistory.service');
const chatService = require('../src/services/chat.service');
const conversationAccessService = require('../src/services/conversationAccess.service');
const whatsappComplianceService = require('../src/services/whatsappCompliance.service');
const models = require('../src/models');

const buttons = [{ id: 'yes', title: 'Yes' }];

test('button interactive message without a header remains valid', () => {
  const payload = buildInteractivePayload({ to: '94770000000', body: 'Choose', buttons });
  assert.equal(payload.recipient_type, 'individual');
  assert.equal(payload.interactive.type, 'button');
  assert.equal(payload.interactive.header, undefined);
});

test('text interactive header uses the Meta text schema', () => {
  const payload = buildInteractivePayload({ to: '94770000000', body: 'Choose', header: { type: 'text', text: 'Header' }, buttons });
  assert.deepEqual(payload.interactive.header, { type: 'text', text: 'Header' });
});

test('image and video headers use Meta media ID objects without captions', () => {
  for (const type of ['image', 'video']) {
    const payload = buildInteractivePayload({ to: '94770000000', body: 'Choose', header: { type, [type]: { id: `meta-${type}` } }, buttons });
    assert.deepEqual(payload.interactive.header, { type, [type]: { id: `meta-${type}` } });
    assert.equal(payload.interactive.header[type].caption, undefined);
  }
});

test('document header includes a sanitized filename and no caption', () => {
  assert.equal(safeFilename('../../secret report?.pdf'), 'secret report_.pdf');
  const payload = buildInteractivePayload({ to: '94770000000', body: 'Choose', header: { type: 'document', document: { id: 'meta-doc', filename: 'report.pdf' } }, buttons });
  assert.deepEqual(payload.interactive.header, { type: 'document', document: { id: 'meta-doc', filename: 'report.pdf' } });
});

test('local image is stored privately and uploaded with the selected account', async () => {
  const calls = [];
  const service = new InteractiveMediaService({ whatsappService: { uploadMedia: async (input) => { calls.push(input); return { id: 'meta-1234' }; } } });
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const result = await service.storeAndUpload({
    scope: 'test-media', scopeId: 'account-42', dataBase64: jpeg.toString('base64'),
    fileName: 'header.jpg', mimeType: 'image/jpeg', mediaType: 'image', whatsappAccountId: 42
  });
  assert.equal(result.mediaId, 'meta-1234');
  assert.equal(result.whatsappAccountId, '42');
  assert.equal(calls[0].whatsappAccountId, 42);
  assert.equal(calls[0].mimeType, 'image/jpeg');
  await fsp.rm(path.join(__dirname, '../private/flow-media/test-media'), { recursive: true, force: true });
});

test('Meta multipart upload uses the selected account endpoint, token, type field, and sanitized logs', async () => {
  const filePath = path.join(os.tmpdir(), `interactive-upload-${Date.now()}.jpg`);
  await fsp.writeFile(filePath, Buffer.from('jpeg'));
  const originals = { config: whatsappService.getWhatsAppConfig, retry: whatsappService.retryRequest, post: axios.post, info: logger.info, error: logger.error };
  const requests = []; const logs = [];
  whatsappService.getWhatsAppConfig = async (id) => ({ apiBaseUrl: 'https://graph.facebook.com', apiVersion: 'v25.0', phoneNumberId: id === 42 ? '1234567890' : 'wrong', accessToken: id === 42 ? 'selected-secret-token' : 'wrong-token', whatsappAccountId: id });
  whatsappService.retryRequest = async (callback) => callback();
  axios.post = async (url, form, options) => { requests.push({ url, streams: form._streams, authorization: options.headers.Authorization }); return { data: { id: 'meta-9876' } }; };
  logger.info = (message, metadata) => logs.push({ message, metadata });
  logger.error = (message, metadata) => logs.push({ message, metadata });
  try {
    const result = await whatsappService.uploadMedia({ filePath, mimeType: 'image/jpeg', mediaType: 'image', fileSize: 4, whatsappAccountId: 42 });
    assert.equal(result.id, 'meta-9876');
    assert.match(requests[0].url, /\/1234567890\/media$/);
    assert.equal(requests[0].authorization, 'Bearer selected-secret-token');
    assert.match(requests[0].streams.join(''), /name="type"[\s\S]*image\/jpeg/);
    assert.doesNotMatch(JSON.stringify(logs), /selected-secret-token|meta-9876/);
    assert.match(JSON.stringify(logs), /9876/);
  } finally {
    whatsappService.getWhatsAppConfig = originals.config;
    whatsappService.retryRequest = originals.retry;
    axios.post = originals.post;
    logger.info = originals.info;
    logger.error = originals.error;
    await fsp.unlink(filePath).catch(() => null);
  }
});

test('media ID from another WhatsApp account is rejected', async () => {
  const service = new InteractiveMediaService({ whatsappService: {} });
  await assert.rejects(
    service.resolveHeader({ type: 'image', mediaId: 'meta-1', whatsappAccountId: 7, mimeType: 'image/jpeg', size: 100, fileName: 'x.jpg' }, { whatsappAccountId: 8, interactiveType: 'button' }),
    (error) => error.code === 'INTERACTIVE_MEDIA_ACCOUNT_MISMATCH'
  );
});

test('invalid MIME type and oversized media are rejected before upload', () => {
  assert.throws(() => validateMedia({ mediaType: 'image', mimeType: 'image/gif', size: 100, fileName: 'x.gif' }), { code: 'INTERACTIVE_MEDIA_MIME_UNSUPPORTED' });
  assert.throws(() => validateMedia({ mediaType: 'image', mimeType: 'image/jpeg', size: 6 * 1024 * 1024, fileName: 'x.jpg' }), { code: 'INTERACTIVE_MEDIA_TOO_LARGE' });
});

test('list messages block media headers', () => {
  assert.throws(() => buildInteractivePayload({ to: '94770000000', body: 'Choose', header: { type: 'image', image: { id: 'meta-1' } }, sections: [{ rows: [{ id: '1', title: 'One' }] }] }), { code: 'INTERACTIVE_HEADER_COMBINATION_UNSUPPORTED' });
});

test('flow interactive node uses shared account-scoped media and pending history', async () => {
  const originals = {
    resolveHeader: interactiveMediaService.resolveHeader,
    send: whatsappService.sendInteractiveMessage,
    prepare: outboundHistoryService.prepare,
    complete: outboundHistoryService.complete,
    fail: outboundHistoryService.fail
  };
  const order = [];
  const historyMessage = { id: 91, rawPayload: {}, update: async () => {} };
  interactiveMediaService.resolveHeader = async (header, options) => {
    order.push(['resolve', options.whatsappAccountId]);
    return { header: { type: 'image', image: { id: 'meta-7' } }, binding: { mediaId: 'meta-7', whatsappAccountId: '7', localMediaRef: 'flow/1/x.jpg', mimeType: 'image/jpeg', size: 100, fileName: 'x.jpg' } };
  };
  outboundHistoryService.prepare = async (payload) => { order.push(['pending', payload.whatsappAccountId]); return { message: historyMessage, conversation: { id: 3 }, payload }; };
  whatsappService.sendInteractiveMessage = async (payload) => { order.push(['send', payload.whatsappAccountId, payload.header.image.id]); return { id: 'wamid-1' }; };
  outboundHistoryService.complete = async () => { order.push(['complete']); };
  outboundHistoryService.fail = async () => { order.push(['fail']); };
  const node = { nodeKey: 'choice', nodeType: 'interactive_message', update: async () => {} };
  try {
    const output = await flowService.executeMessageNode(node, {
      message: 'Choose', headerType: 'image', headerMediaId: 'old', headerMediaAccountId: 6,
      headerMediaMimeType: 'image/jpeg', headerMediaSize: 100, headerMediaFileName: 'x.jpg',
      buttons: [{ id: 'yes', title: 'Yes' }]
    }, { flowId: 1, conversationId: 3, contactId: 2, contact: { phone: '94770000000' }, whatsappAccountId: 7 }, true);
    assert.equal(output.response.id, 'wamid-1');
    assert.deepEqual(order.map((item) => item[0]), ['resolve', 'pending', 'send', 'complete']);
    assert.deepEqual(order[2].slice(1), [7, 'meta-7']);
  } finally {
    interactiveMediaService.resolveHeader = originals.resolveHeader;
    whatsappService.sendInteractiveMessage = originals.send;
    outboundHistoryService.prepare = originals.prepare;
    outboundHistoryService.complete = originals.complete;
    outboundHistoryService.fail = originals.fail;
  }
});

test('Meta interactive send failure preserves the pending history as failed', async () => {
  const originals = {
    resolveHeader: interactiveMediaService.resolveHeader,
    send: whatsappService.sendInteractiveMessage,
    prepare: outboundHistoryService.prepare,
    complete: outboundHistoryService.complete,
    fail: outboundHistoryService.fail
  };
  let failed = 0; let completed = 0;
  interactiveMediaService.resolveHeader = async () => ({ header: null, binding: null });
  outboundHistoryService.prepare = async (payload) => ({ message: { id: 92, rawPayload: {}, update: async () => {} }, conversation: { id: 3 }, payload });
  whatsappService.sendInteractiveMessage = async () => { const error = new Error('Meta rejected payload'); error.response = { data: { error: { code: 100, error_subcode: 2494010, type: 'OAuthException', message: 'Invalid parameter' } } }; throw error; };
  outboundHistoryService.fail = async () => { failed += 1; };
  outboundHistoryService.complete = async () => { completed += 1; };
  try {
    await assert.rejects(flowService.executeMessageNode(
      { nodeKey: 'choice', nodeType: 'interactive_message', update: async () => {} },
      { message: 'Choose', headerType: 'none', buttons },
      { flowId: 1, conversationId: 3, contactId: 2, contact: { phone: '94770000000' }, whatsappAccountId: 7 }, true
    ), /Meta rejected payload/);
    assert.equal(failed, 1); assert.equal(completed, 0);
  } finally {
    interactiveMediaService.resolveHeader = originals.resolveHeader;
    whatsappService.sendInteractiveMessage = originals.send;
    outboundHistoryService.prepare = originals.prepare;
    outboundHistoryService.complete = originals.complete;
    outboundHistoryService.fail = originals.fail;
  }
});

test('Inbox interactive retry reuses one CRM message and canonical selected account', async () => {
  const originals = {
    access: conversationAccessService.assertConversationAccess,
    canonical: chatService.canonicalConversation,
    compliance: whatsappComplianceService.canSendFreeFormMessage,
    resolve: interactiveMediaService.resolveHeader,
    runtime: whatsappService.getRuntimeConfig,
    send: whatsappService.sendInteractiveMessage,
    find: models.Message.findOne,
    create: models.Message.create,
    get: chatService.getMessageWithReplyPreview
  };
  const conversation = { id: 30, contactId: 2, whatsappAccountId: 7, contact: { phone: '94770000000' }, update: async () => {} };
  let stored = null; let creates = 0; let sends = 0;
  conversationAccessService.assertConversationAccess = async () => {};
  chatService.canonicalConversation = async () => conversation;
  whatsappComplianceService.canSendFreeFormMessage = async () => ({ canSend: true });
  interactiveMediaService.resolveHeader = async () => ({ header: null, binding: null });
  whatsappService.getRuntimeConfig = async (id) => ({ whatsappAccountId: id, phoneNumberId: '1234567890' });
  whatsappService.sendInteractiveMessage = async (input) => { sends += 1; assert.equal(input.whatsappAccountId, 7); return { id: 'wamid-once' }; };
  models.Message.findOne = async () => stored;
  models.Message.create = async (values) => {
    creates += 1;
    stored = { id: 99, ...values, whatsappMessageId: null, update: async (patch) => Object.assign(stored, patch) };
    return stored;
  };
  chatService.getMessageWithReplyPreview = async () => stored;
  try {
    const input = { conversationId: 55, senderId: 8, body: 'Choose', buttons, clientRequestId: 'same-request' };
    await chatService.sendChatInteractive(input);
    await chatService.sendChatInteractive(input);
    assert.equal(creates, 1); assert.equal(sends, 1);
    assert.equal(stored.conversationId, 30);
    assert.equal(stored.whatsappAccountId, 7);
    assert.equal(stored.status, 'sent');
  } finally {
    conversationAccessService.assertConversationAccess = originals.access;
    chatService.canonicalConversation = originals.canonical;
    whatsappComplianceService.canSendFreeFormMessage = originals.compliance;
    interactiveMediaService.resolveHeader = originals.resolve;
    whatsappService.getRuntimeConfig = originals.runtime;
    whatsappService.sendInteractiveMessage = originals.send;
    models.Message.findOne = originals.find;
    models.Message.create = originals.create;
    chatService.getMessageWithReplyPreview = originals.get;
  }
});

test('Meta upload failure creates no sent Inbox message', async () => {
  const originals = {
    access: conversationAccessService.assertConversationAccess,
    canonical: chatService.canonicalConversation,
    compliance: whatsappComplianceService.canSendFreeFormMessage,
    upload: interactiveMediaService.storeAndUpload,
    find: models.Message.findOne,
    create: models.Message.create
  };
  let creates = 0;
  conversationAccessService.assertConversationAccess = async () => {};
  chatService.canonicalConversation = async () => ({ id: 30, contactId: 2, whatsappAccountId: 7, contact: { phone: '94770000000' } });
  whatsappComplianceService.canSendFreeFormMessage = async () => ({ canSend: true });
  models.Message.findOne = async () => null;
  models.Message.create = async () => { creates += 1; };
  interactiveMediaService.storeAndUpload = async () => { throw Object.assign(new Error('Media upload failed'), { code: 'META_MEDIA_UPLOAD_FAILED', status: 502 }); };
  try {
    await assert.rejects(chatService.sendChatInteractive({
      conversationId: 30, senderId: 8, body: 'Choose', buttons, clientRequestId: 'upload-fail',
      header: { type: 'image', fileName: 'x.jpg', mimeType: 'image/jpeg', dataBase64: 'abc' }
    }), /Media upload failed/);
    assert.equal(creates, 0);
  } finally {
    conversationAccessService.assertConversationAccess = originals.access;
    chatService.canonicalConversation = originals.canonical;
    whatsappComplianceService.canSendFreeFormMessage = originals.compliance;
    interactiveMediaService.storeAndUpload = originals.upload;
    models.Message.findOne = originals.find;
    models.Message.create = originals.create;
  }
});

test('Inbox Meta send failure stores only sanitized error fields and never marks sent', async () => {
  const originals = {
    access: conversationAccessService.assertConversationAccess,
    canonical: chatService.canonicalConversation,
    compliance: whatsappComplianceService.canSendFreeFormMessage,
    resolve: interactiveMediaService.resolveHeader,
    runtime: whatsappService.getRuntimeConfig,
    send: whatsappService.sendInteractiveMessage,
    find: models.Message.findOne,
    create: models.Message.create,
    get: chatService.getMessageWithReplyPreview
  };
  let stored;
  conversationAccessService.assertConversationAccess = async () => {};
  chatService.canonicalConversation = async () => ({ id: 30, contactId: 2, whatsappAccountId: 7, contact: { phone: '94770000000' } });
  whatsappComplianceService.canSendFreeFormMessage = async () => ({ canSend: true });
  interactiveMediaService.resolveHeader = async () => ({ header: null, binding: null });
  whatsappService.getRuntimeConfig = async () => ({ phoneNumberId: '1234567890' });
  models.Message.findOne = async () => null;
  models.Message.create = async (values) => { stored = { id: 100, ...values, update: async (patch) => Object.assign(stored, patch) }; return stored; };
  chatService.getMessageWithReplyPreview = async () => stored;
  whatsappService.sendInteractiveMessage = async () => {
    const error = new Error('request failed');
    error.response = { data: { error: { code: 100, error_subcode: 2494010, type: 'OAuthException', message: 'Invalid parameter' } } };
    throw error;
  };
  try {
    await assert.rejects(chatService.sendChatInteractive({ conversationId: 30, senderId: 8, body: 'Choose', buttons, clientRequestId: 'send-fail' }));
    assert.equal(stored.status, 'failed');
    assert.equal(stored.errorCode, '100');
    assert.equal(stored.errorSubcode, '2494010');
    assert.equal(stored.rawPayload.deliveryError.type, 'OAuthException');
    assert.doesNotMatch(JSON.stringify(stored.rawPayload), /token|authorization|94770000000/i);
  } finally {
    conversationAccessService.assertConversationAccess = originals.access;
    chatService.canonicalConversation = originals.canonical;
    whatsappComplianceService.canSendFreeFormMessage = originals.compliance;
    interactiveMediaService.resolveHeader = originals.resolve;
    whatsappService.getRuntimeConfig = originals.runtime;
    whatsappService.sendInteractiveMessage = originals.send;
    models.Message.findOne = originals.find;
    models.Message.create = originals.create;
    chatService.getMessageWithReplyPreview = originals.get;
  }
});
