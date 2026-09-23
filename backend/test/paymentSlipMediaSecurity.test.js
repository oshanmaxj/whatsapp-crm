const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { PassThrough } = require('node:stream');
const { Media, Message, PaymentSlip } = require('../src/models');
const inboxService = require('../src/services/inbox.service');
const conversationAccessService = require('../src/services/conversationAccess.service');
const mediaController = require('../src/controllers/media.controller');
const storageService = require('../src/services/storage.service');
const whatsappService = require('../src/services/whatsapp.service');
const { normalizeMessagePresentation } = require('../src/services/messagePresentation.service');

const originals = {
  mediaFindByPk: Media.findByPk,
  mediaFindOne: Media.findOne,
  messageFindOne: Message.findOne,
  paymentSlipFindOne: PaymentSlip.findOne,
  assertAccess: conversationAccessService.assertConversationAccess,
  uploadToSupabase: storageService.uploadToSupabase,
  uploadToStorage: whatsappService.uploadToStorage
};

test.afterEach(() => {
  Media.findByPk = originals.mediaFindByPk;
  Media.findOne = originals.mediaFindOne;
  Message.findOne = originals.messageFindOne;
  PaymentSlip.findOne = originals.paymentSlipFindOne;
  conversationAccessService.assertConversationAccess = originals.assertAccess;
  storageService.uploadToSupabase = originals.uploadToSupabase;
  whatsappService.uploadToStorage = originals.uploadToStorage;
});

// --- Task 1/5: the old public bypass is closed ------------------------------

test('#1/#5 app.js no longer mounts /uploads/whatsapp publicly — only lms-materials, media, and template-samples are still public static roots', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/app.js'), 'utf8');
  assert.doesNotMatch(source, /app\.use\(['"]\/uploads['"],\s*express\.static/, 'the old blanket /uploads mount (which covered whatsapp/) must be gone');
  assert.match(source, /\['lms-materials', 'media', 'template-samples'\]/);
  assert.doesNotMatch(source, /uploads\/\$\{subdir\}.*whatsapp/);
});

// --- Task 3/4/6: media is private from the moment it is downloaded, regardless of classification confidence ---

test('#3/#4/#6 the inbound WhatsApp message handler downloads media with private:true — there is no public-until-classified window', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/whatsapp.service.js'), 'utf8');
  const inboundBlock = source.slice(source.indexOf('let attachment = null;'), source.indexOf('let attachment = null;') + 2500);
  assert.match(inboundBlock, /downloadAndStoreMedia\(mediaId,\s*\{[^}]*private:\s*true/s);
});

test('#3/#4/#6 uploadToStorage({private:true}) writes outside the public uploads root and returns no public URL', async () => {
  let captured = null;
  storageService.uploadToSupabase = async (options) => { captured = options; return { path: 'x', absolutePath: '/private/whatsapp-media/x', url: options.makePublicUrl === false ? null : '/uploads/x' }; };
  const result = await whatsappService.uploadToStorage({ path: 'whatsapp/1/a.jpg', buffer: Buffer.from('x'), mimeType: 'image/jpeg', private: true });
  assert.equal(captured.makePublicUrl, false);
  assert.ok(captured.root && /private/i.test(String(captured.root)), 'must target a private root, not the public uploads/ tree');
  assert.equal(result.url, null);
});

test('flow-builder\'s outbound uploadToStorage calls (no `private` flag) are unaffected — still public, still the original uploads root', async () => {
  let captured = null;
  storageService.uploadToSupabase = async (options) => { captured = options; return { path: 'x', absolutePath: '/uploads/whatsapp/x', url: '/uploads/x' }; };
  await whatsappService.uploadToStorage({ path: 'whatsapp/1/a.jpg', buffer: Buffer.from('x'), mimeType: 'image/jpeg' });
  assert.equal(captured.root, undefined);
  assert.equal(captured.makePublicUrl, undefined);
});

test('storage.service.js sanitizes ../ traversal against a custom private root exactly as it does against the public root — the write always lands inside the given root', async () => {
  const root = path.join(os.tmpdir(), `crm-private-test-root-${process.pid}-${Date.now()}`);
  try {
    const result = await storageService.uploadToSupabase({ path: '../../etc/passwd', buffer: Buffer.from('x'), contentType: 'text/plain', root });
    const resolvedRoot = path.resolve(root);
    assert.ok(result.absolutePath === resolvedRoot || result.absolutePath.startsWith(resolvedRoot + path.sep), 'a traversal attempt must never escape the given root, private or public');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- Task 5/7: authorization — ordinary conversation access vs. classified payment proof ---

test('#7 an ordinary conversation-access user CAN retrieve normal (non-payment-slip) WhatsApp media by its WhatsApp media id', async () => {
  Message.findOne = async ({ where }) => (where.mediaId === 'wamid-1' ? { id: 900 } : null);
  Media.findOne = async ({ where }) => (where.messageId === 900 ? { id: 55, conversationId: 3, messageId: 900 } : null);
  PaymentSlip.findOne = async () => null;
  let assertedConversationId = null;
  conversationAccessService.assertConversationAccess = async (conversationId) => { assertedConversationId = conversationId; return { id: conversationId }; };

  const media = await inboxService.getMediaByWhatsappMediaId('wamid-1', 42);

  assert.equal(media.id, 55);
  assert.equal(assertedConversationId, 3);
});

test('#2/#8 a user without access to the owning conversation is rejected (403), not silently served the file — no ID/mediaId guessing bypass', async () => {
  Message.findOne = async () => ({ id: 900 });
  Media.findOne = async () => ({ id: 55, conversationId: 3, messageId: 900 });
  PaymentSlip.findOne = async () => null;
  conversationAccessService.assertConversationAccess = async () => { throw Object.assign(new Error('You do not have access to this conversation'), { status: 403 }); };

  await assert.rejects(() => inboxService.getMediaByWhatsappMediaId('wamid-1', 42), (error) => { assert.equal(error.status, 403); return true; });
});

test('#8 an unknown/guessed WhatsApp media id resolves to 404, not a filesystem error or another user\'s file', async () => {
  Message.findOne = async () => null;
  await assert.rejects(() => inboxService.getMediaByWhatsappMediaId('does-not-exist', 42), (error) => { assert.equal(error.status, 404); return true; });
});

test('once a message\'s media is classified as a payment slip, ordinary conversation access is no longer enough — even for the plain /api/media/:id/download path', async () => {
  Media.findByPk = async (id) => (id === '55' ? { id: 55, conversationId: 3, messageId: 900 } : null);
  PaymentSlip.findOne = async ({ where }) => (where.whatsappMessageId === 900 ? { id: 1 } : null);
  let accessChecked = false;
  conversationAccessService.assertConversationAccess = async () => { accessChecked = true; return { id: 3 }; };

  await assert.rejects(
    () => inboxService.getMedia('55', 42),
    (error) => { assert.equal(error.status, 403); assert.equal(error.code, 'PAYMENT_SLIP_REQUIRES_PAYMENT_AUTH'); return true; }
  );
  assert.equal(accessChecked, false, 'the stricter payment-slip check must short-circuit before even reaching the ordinary conversation-access check');
});

test('the same classified-slip guard applies when resolving by WhatsApp media id, not just by internal Media.id', async () => {
  Message.findOne = async () => ({ id: 900 });
  Media.findOne = async () => ({ id: 55, conversationId: 3, messageId: 900 });
  PaymentSlip.findOne = async () => ({ id: 1 });

  await assert.rejects(
    () => inboxService.getMediaByWhatsappMediaId('wamid-1', 42),
    (error) => { assert.equal(error.code, 'PAYMENT_SLIP_REQUIRES_PAYMENT_AUTH'); return true; }
  );
});

test('media that has never been linked to a message (messageId null) skips the PaymentSlip lookup and falls through to ordinary conversation access', async () => {
  Media.findByPk = async () => ({ id: 60, conversationId: 3, messageId: null });
  let paymentSlipQueried = false;
  PaymentSlip.findOne = async () => { paymentSlipQueried = true; return null; };
  conversationAccessService.assertConversationAccess = async () => ({ id: 3 });

  const media = await inboxService.getMedia(60, 42);
  assert.equal(media.id, 60);
  assert.equal(paymentSlipQueried, false);
});

// --- Task 8 test #1: no auth at all -----------------------------------------

test('media.routes.js requires authentication for both the by-id and by-WhatsApp-media-id download routes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/routes/media.routes.js'), 'utf8');
  const authLine = source.split('\n').findIndex((line) => /router\.use\(authMiddleware\.authenticate\)/.test(line));
  const whatsappRouteLine = source.split('\n').findIndex((line) => line.includes("'/whatsapp/:whatsappMediaId/download'") && line.includes('get'));
  assert.ok(authLine > -1 && whatsappRouteLine > -1 && authLine < whatsappRouteLine, 'router.use(authenticate) must run before the whatsapp-media-id route is registered');
});

// --- Task 9: existing inbox media rendering is not broken -------------------

test('#9 mediaFromMessage rewrites a legacy /uploads/whatsapp/... URL to the authenticated endpoint for an inbound message with a mediaId', () => {
  const json = { direction: 'inbound', type: 'image', mediaId: 'wamid-legacy-1', mediaUrl: '/uploads/whatsapp/wamid-legacy-1/photo.jpg' };
  const result = normalizeMessagePresentation({ toJSON: () => json });
  assert.equal(result.media.url, '/api/media/whatsapp/wamid-legacy-1/download');
});

test('#9 mediaFromMessage does NOT resurrect a URL that was deliberately nulled (a classified/privatized payment slip must stay hidden from ordinary chat rendering)', () => {
  const json = { direction: 'inbound', type: 'image', mediaId: 'wamid-legacy-2', mediaUrl: null };
  const result = normalizeMessagePresentation({ toJSON: () => json });
  assert.equal(result.media.url, null);
});

test('#9 a NEW-shaped inbound message (already /api/media/whatsapp/...) passes through unchanged', () => {
  const json = { direction: 'inbound', type: 'image', mediaId: 'wamid-3', mediaUrl: '/api/media/whatsapp/wamid-3/download' };
  const result = normalizeMessagePresentation({ toJSON: () => json });
  assert.equal(result.media.url, '/api/media/whatsapp/wamid-3/download');
});

test('#9 outbound messages are never rewritten by the inbound legacy-URL compatibility shim', () => {
  const json = { direction: 'outbound', type: 'image', mediaId: 'wamid-4', mediaUrl: '/uploads/whatsapp/wamid-4/photo.jpg' };
  const result = normalizeMessagePresentation({ toJSON: () => json });
  assert.equal(result.media.url, '/uploads/whatsapp/wamid-4/photo.jpg');
});

// --- Task 9: mediaController.download() still works unchanged after the refactor ---

test('#9/#10 mediaController.download() still streams correctly after being refactored to share logic with downloadByWhatsappMediaId()', async () => {
  const filePath = path.join(os.tmpdir(), `crm-media-security-${process.pid}-${Date.now()}.jpg`);
  fs.writeFileSync(filePath, Buffer.from('hello-world'));
  Media.findByPk = async () => ({ id: 1, conversationId: 3, messageId: null, storagePath: filePath, mimeType: 'image/jpeg', mediaType: 'image', originalName: 'a.jpg' });
  PaymentSlip.findOne = async () => null;
  conversationAccessService.assertConversationAccess = async () => ({ id: 3 });
  const response = new PassThrough();
  response.headers = {};
  response.statusCode = 200;
  response.setHeader = (name, value) => { response.headers[name.toLowerCase()] = String(value); };
  response.set = (name, value) => { response.setHeader(name, value); return response; };
  response.status = (status) => { response.statusCode = status; return response; };
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => { response.on('end', resolve); response.on('error', reject); });
  try {
    await mediaController.download({ params: { id: '1' }, user: { id: 42 }, method: 'GET', headers: {} }, response, (error) => { throw error; });
    await finished;
    assert.equal(response.statusCode, 200);
    assert.equal(Buffer.concat(chunks).toString(), 'hello-world');
  } finally {
    fs.unlinkSync(filePath);
  }
});
