const test = require('node:test');
const assert = require('node:assert/strict');
const flowService = require('../src/services/flow.service');
const whatsappService = require('../src/services/whatsapp.service');
const outboundHistory = require('../src/services/outboundHistory.service');
const { createOutboundHistoryService } = require('../src/services/outboundHistory.service');
const { normalizeMessagePresentation } = require('../src/services/messagePresentation.service');

function mutable(values) {
  return { ...values, update: async function update(patch) { Object.assign(this, patch); return this; }, toJSON() { return { ...this, update: undefined, toJSON: undefined }; } };
}

test('flow image persists canonical media and never turns its filename into a caption', async () => {
  const originals = { send: whatsappService.sendMediaMessage, record: outboundHistory.record };
  let sent; let recorded;
  whatsappService.sendMediaMessage = async (payload) => { sent = payload; return { id: 'wamid-image' }; };
  outboundHistory.record = async (payload) => { recorded = payload; return payload; };
  try {
    await flowService.executeMessageNode(
      { nodeKey: 'image-1', nodeType: 'image_message', label: 'Blue Neon Payment.jpg' },
      { sourceType: 'media_id', whatsappMediaId: 'meta-image', mediaLocalRef: 'flow/1/image.jpg', mimeType: 'image/jpeg', mediaSize: 12, fileName: 'Blue Neon Payment.jpg', caption: '' },
      { flowId: 1, conversationId: 3, contactId: 2, contact: { phone: '94770000000' }, whatsappAccountId: 7 }, true
    );
    assert.equal(sent.caption, '');
    assert.equal(recorded.text, '');
    assert.equal(recorded.type, 'image');
    assert.equal(recorded.media.localMediaRef, 'flow/1/image.jpg');
    assert.equal(recorded.media.filename, null);
    assert.equal(recorded.media.originalFilename, 'Blue Neon Payment.jpg');
  } finally { whatsappService.sendMediaMessage = originals.send; outboundHistory.record = originals.record; }
});

test('flow video and document persist reloadable URLs while document keeps only its technical filename', async () => {
  const originals = { send: whatsappService.sendMediaMessage, record: outboundHistory.record };
  const sent = []; const recorded = [];
  whatsappService.sendMediaMessage = async (payload) => { sent.push(payload); return { id: `wamid-${sent.length}` }; };
  outboundHistory.record = async (payload) => { recorded.push(payload); return payload; };
  const context = { flowId: 1, conversationId: 3, contactId: 2, contact: { phone: '94770000000' }, whatsappAccountId: 7 };
  try {
    await flowService.executeMessageNode({ nodeKey: 'video', nodeType: 'video_message', label: 'movie.mp4' }, { mediaUrl: 'https://cdn.example/video.mp4', caption: 'Watch this' }, context, true);
    await flowService.executeMessageNode({ nodeKey: 'doc', nodeType: 'file_document', label: 'guide.pdf' }, { fileUrl: 'https://cdn.example/guide.pdf', fileName: 'guide.pdf', caption: '' }, context, true);
    assert.equal(recorded[0].mediaUrl, 'https://cdn.example/video.mp4');
    assert.equal(recorded[0].media.caption, 'Watch this');
    assert.equal(recorded[1].mediaUrl, 'https://cdn.example/guide.pdf');
    assert.equal(recorded[1].text, '');
    assert.equal(sent[1].filename, 'guide.pdf');
  } finally { whatsappService.sendMediaMessage = originals.send; outboundHistory.record = originals.record; }
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
