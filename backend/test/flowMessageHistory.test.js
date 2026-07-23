const test = require('node:test');
const assert = require('node:assert/strict');
const flowService = require('../src/services/flow.service');
const whatsappService = require('../src/services/whatsapp.service');
const outboundHistory = require('../src/services/outboundHistory.service');
const { createOutboundHistoryService } = require('../src/services/outboundHistory.service');
const { normalizeMessagePresentation } = require('../src/services/messagePresentation.service');
const fsp = require('fs/promises');
const path = require('path');
const logger = require('../src/config/logger');

function mutable(values) {
  return { ...values, update: async function update(patch) { Object.assign(this, patch); return this; }, toJSON() { return { ...this, update: undefined, toJSON: undefined }; } };
}

test('flow image persists canonical media and never turns its filename into a caption', async () => {
  const originals = { send: whatsappService.sendMediaMessage, prepare: outboundHistory.prepare, complete: outboundHistory.complete, fail: outboundHistory.fail };
  let sent; let recorded;
  whatsappService.sendMediaMessage = async (payload) => { sent = payload; return { id: 'wamid-image' }; };
  outboundHistory.prepare = async (payload) => { recorded = payload; return { payload, message: mutable({ id: 10, rawPayload: payload.rawPayload }), conversation: { id: 3 } }; };
  outboundHistory.complete = async () => {};
  outboundHistory.fail = async () => {};
  try {
    await flowService.executeMessageNode(
      { nodeKey: 'image-1', nodeType: 'image_message', label: 'Blue Neon Payment.jpg' },
      { sourceType: 'media_id', whatsappMediaId: 'meta-image', mediaLocalRef: 'flow/1/image.jpg', mimeType: 'image/jpeg', mediaSize: 12, fileName: 'Blue Neon Payment.jpg', caption: '' },
      { flowId: 1, conversationId: 3, contactId: 2, contact: { phone: '94770000000' }, whatsappAccountId: 7 }, true
    );
    assert.equal(sent.caption, '');
    assert.equal(recorded.text, null);
    assert.equal(recorded.type, 'image');
    assert.equal(recorded.media.localMediaRef, 'flow/1/image.jpg');
    assert.equal(recorded.media.filename, null);
    assert.equal(recorded.media.originalFilename, 'Blue Neon Payment.jpg');
  } finally { Object.assign(whatsappService, { sendMediaMessage: originals.send }); Object.assign(outboundHistory, { prepare: originals.prepare, complete: originals.complete, fail: originals.fail }); }
});

test('flow video and document persist reloadable URLs while document keeps only its technical filename', async () => {
  const originals = { send: whatsappService.sendMediaMessage, prepare: outboundHistory.prepare, complete: outboundHistory.complete, fail: outboundHistory.fail };
  const sent = []; const recorded = [];
  whatsappService.sendMediaMessage = async (payload) => { sent.push(payload); return { id: `wamid-${sent.length}` }; };
  outboundHistory.prepare = async (payload) => { recorded.push(payload); return { payload, message: mutable({ id: recorded.length, rawPayload: payload.rawPayload }), conversation: { id: 3 } }; };
  outboundHistory.complete = async () => {};
  outboundHistory.fail = async () => {};
  const context = { flowId: 1, conversationId: 3, contactId: 2, contact: { phone: '94770000000' }, whatsappAccountId: 7 };
  try {
    await flowService.executeMessageNode({ nodeKey: 'video', nodeType: 'video_message', label: 'movie.mp4' }, { mediaUrl: 'https://cdn.example/video.mp4', caption: 'Watch this' }, context, true);
    await flowService.executeMessageNode({ nodeKey: 'doc', nodeType: 'file_document', label: 'guide.pdf' }, { fileUrl: 'https://cdn.example/guide.pdf', fileName: 'guide.pdf', caption: '' }, context, true);
    assert.equal(recorded[0].mediaUrl, 'https://cdn.example/video.mp4');
    assert.equal(recorded[0].media.caption, 'Watch this');
    assert.equal(recorded[1].mediaUrl, 'https://cdn.example/guide.pdf');
    assert.equal(recorded[1].text, null);
    assert.equal(sent[1].filename, 'guide.pdf');
  } finally { Object.assign(whatsappService, { sendMediaMessage: originals.send }); Object.assign(outboundHistory, { prepare: originals.prepare, complete: originals.complete, fail: originals.fail }); }
});

test('legacy base64 flow source is privately stored, uploaded with the explicit account, then sent by Meta media ID', async () => {
  const originals = {
    upload: whatsappService.uploadMedia, send: whatsappService.sendMediaMessage,
    prepare: outboundHistory.prepare, complete: outboundHistory.complete, fail: outboundHistory.fail
  };
  let upload; let send;
  whatsappService.uploadMedia = async (payload) => { upload = payload; return { id: 'meta-uploaded' }; };
  whatsappService.sendMediaMessage = async (payload) => { send = payload; return { id: 'wamid-uploaded' }; };
  outboundHistory.prepare = async (payload) => ({ payload, message: mutable({ id: 20, rawPayload: payload.rawPayload }), conversation: { id: 3 } });
  outboundHistory.complete = async () => {};
  outboundHistory.fail = async () => {};
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  try {
    await flowService.executeMessageNode(
      { nodeKey: 'legacy-image', nodeType: 'image_message', label: 'Image' },
      { mediaUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`, mimeType: 'image/jpeg', fileName: 'photo.jpg' },
      { flowId: 55, conversationId: 3, contactId: 2, contact: { phone: '94770000000' }, whatsappAccountId: 77 }, true
    );
    assert.equal(upload.whatsappAccountId, 77);
    assert.equal(upload.mimeType, 'image/jpeg');
    assert.equal(upload.fileSize, 4);
    assert.equal(send.whatsappAccountId, 77);
    assert.equal(send.mediaId, 'meta-uploaded');
    assert.equal(send.url, null);
    assert.equal(send.caption, '');
  } finally {
    Object.assign(whatsappService, { uploadMedia: originals.upload, sendMediaMessage: originals.send });
    Object.assign(outboundHistory, { prepare: originals.prepare, complete: originals.complete, fail: originals.fail });
    await fsp.rm(path.join(__dirname, '../private/flow-media/flow/55'), { recursive: true, force: true });
  }
});

test('flow image, video, audio, and document reuse Meta IDs without filename captions', async () => {
  const originals = {
    send: whatsappService.sendMediaMessage, download: whatsappService.downloadAndStoreMedia,
    prepare: outboundHistory.prepare, complete: outboundHistory.complete, fail: outboundHistory.fail
  };
  const sent = []; const persisted = [];
  whatsappService.downloadAndStoreMedia = async (id) => ({ storageUrl: `/uploads/whatsapp-media/${id}` });
  whatsappService.sendMediaMessage = async (payload) => { sent.push(payload); return { id: `wamid-${sent.length}` }; };
  outboundHistory.prepare = async (payload) => { persisted.push(payload); return { payload, message: mutable({ id: persisted.length, rawPayload: payload.rawPayload }), conversation: { id: 3 } }; };
  outboundHistory.complete = async () => {};
  outboundHistory.fail = async () => {};
  const context = { flowId: 9, conversationId: 3, contactId: 2, contact: { phone: '94770000000' }, whatsappAccountId: 77 };
  const cases = [
    ['image_message', 'image', 'image/jpeg', 'photo.jpg'],
    ['video_message', 'video', 'video/mp4', 'movie.mp4'],
    ['audio_message', 'audio', 'audio/mpeg', 'voice.mp3'],
    ['file_document', 'document', 'application/pdf', 'guide.pdf']
  ];
  try {
    for (const [nodeType, mediaType, mimeType, fileName] of cases) {
      await flowService.executeMessageNode(
        { nodeKey: mediaType, nodeType, label: fileName },
        { whatsappMediaId: `meta-${mediaType}`, mediaAccountId: 77, mimeType, fileName, caption: '' },
        context, true
      );
    }
    assert.deepEqual(sent.map((item) => item.mediaType), ['image', 'video', 'audio', 'document']);
    assert.ok(sent.every((item) => item.whatsappAccountId === 77 && item.mediaId && !item.url));
    assert.equal(sent[0].filename, undefined);
    assert.equal(sent[1].filename, undefined);
    assert.equal(sent[2].filename, undefined);
    assert.equal(sent[3].filename, 'guide.pdf');
    assert.equal(persisted.length, 4);
    assert.ok(persisted.every((item) => item.status === 'pending'));
  } finally {
    Object.assign(whatsappService, { sendMediaMessage: originals.send, downloadAndStoreMedia: originals.download });
    Object.assign(outboundHistory, { prepare: originals.prepare, complete: originals.complete, fail: originals.fail });
  }
});

test('recursive logger redaction removes base64, buffers, authorization, and tokens', () => {
  const secret = 'very-secret-token';
  const redacted = logger.redact({
    request: {
      Authorization: `Bearer ${secret}`,
      nested: { dataBase64: Buffer.alloc(400, 1).toString('base64'), raw: Buffer.alloc(12) }
    }
  });
  const output = JSON.stringify(redacted);
  assert.doesNotMatch(output, new RegExp(secret));
  assert.doesNotMatch(output, /AQEBAQEBAQ/);
  assert.match(output, /REDACTED|BUFFER/);
});

test('Meta Graph 400 media errors are logged and persisted as sanitized fields only', async () => {
  const originals = {
    config: whatsappService.getWhatsAppConfig,
    request: whatsappService.sendRequest,
    error: logger.error
  };
  const logs = [];
  const token = 'production-like-secret-token';
  whatsappService.getWhatsAppConfig = async () => ({
    whatsappAccountId: 77, phoneNumberId: '123456789', accessToken: token,
    apiVersion: 'v25.0', apiBaseUrl: 'https://graph.facebook.com'
  });
  whatsappService.sendRequest = async () => {
    const error = new Error('Axios 400');
    error.response = { status: 400, data: { error: {
      code: 100, error_subcode: 2494010, message: 'Invalid media parameter',
      error_data: { details: 'Unsupported codec' }, fbtrace_id: 'trace-safe'
    } } };
    error.config = { headers: { Authorization: `Bearer ${token}` }, data: Buffer.alloc(400).toString('base64') };
    throw error;
  };
  logger.error = (event, metadata) => logs.push({ event, metadata });
  try {
    await assert.rejects(whatsappService.sendMediaMessage({
      to: '94770000000', mediaType: 'video', mediaId: 'meta-video',
      mimeType: 'video/mp4', byteLength: 1234, whatsappAccountId: 77,
      conversationId: 3, flowId: 9, log: false
    }));
    const output = JSON.stringify(logs);
    assert.match(output, /2494010/);
    assert.match(output, /Unsupported codec/);
    assert.doesNotMatch(output, new RegExp(token));
    assert.doesNotMatch(output, /Bearer|AQEBAQEBAQ/);
  } finally {
    whatsappService.getWhatsAppConfig = originals.config;
    whatsappService.sendRequest = originals.request;
    logger.error = originals.error;
  }
});

test('canonical history creates authenticated CRM media URL and emits the same normalized shape', async () => {
  let message; let socketEvent;
  const service = createOutboundHistoryService({
    Contact: { findByPk: async () => ({ id: 2 }) },
    Message: {
      findByPk: async () => null, findOne: async () => null,
      create: async (values) => { message = mutable({ id: 10, ...values }); return message; }
    },
    Media: { create: async (values) => mutable({ id: 50, ...values }) },
    canonicalConversationService: { resolveCanonicalWhatsAppConversation: async () => mutable({ id: 3, whatsappAccountId: 7 }) },
    socketService: { emitToRoom: (_, __, event) => { socketEvent = event; }, emitToConversationAudience: async () => {} },
    logger: { warn: () => {} }
  });
  const prepared = await service.prepare({
    contactId: 2, conversationId: 3, phone: '94770000000', whatsappAccountId: 7,
    type: 'image', messageType: 'image', text: null,
    media: { type: 'image', localMediaRef: 'flow/1/image.jpg', mimeType: 'image/jpeg', size: 12, originalFilename: 'private.jpg', whatsappMediaId: 'meta-1', caption: null }
  });
  await service.complete(prepared, { whatsappMessageId: 'wamid-1', rawPayload: { whatsappMessageId: 'wamid-1' } });
  assert.equal(message.mediaUrl, '/api/media/50/download');
  assert.equal(message.rawPayload.media.crmMediaId, 50);
  assert.equal(message.rawPayload.whatsappMessageId, 'wamid-1');
  assert.equal(socketEvent.media.url, '/api/media/50/download');
  assert.equal(normalizeMessagePresentation(message).media.url, socketEvent.media.url);
  assert.equal(socketEvent.text, null);
});

test('inbound interactive replies display titles while retaining machine payloads', () => {
  const button = whatsappService.parseInboundContent({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'flowbtn_1', title: 'Pay' } } });
  const list = whatsappService.parseInboundContent({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'row_1', title: 'Support', description: 'Contact us' } } });
  assert.equal(button.text, 'Pay');
  assert.equal(button.buttonPayload, 'flowbtn_1');
  assert.equal(list.text, 'Support');
  assert.equal(list.buttonPayload, 'row_1');
  assert.equal(list.interactiveDescription, 'Contact us');
});

test('old interactive records normalize to human titles with payload fallback', () => {
  const old = normalizeMessagePresentation({
    type: 'text', text: 'Customer selected: Pay\nPayload: flowbtn_1', buttonPayload: 'flowbtn_1',
    interactiveType: 'button_reply', rawPayload: { interactive: { type: 'button_reply', button_reply: { id: 'flowbtn_1', title: 'Pay' } } }
  });
  assert.equal(old.text, 'Pay');
  assert.equal(old.interactiveReply.id, 'flowbtn_1');
  assert.equal(old.interactiveReply.title, 'Pay');
  const outbound = normalizeMessagePresentation({
    direction: 'outbound', type: 'text', messageType: 'interactive', text: 'Choose',
    rawPayload: { interactive: { kind: 'button', buttons: [{ id: 'one', title: 'One' }] } }
  });
  assert.equal(outbound.type, 'interactive');
});
