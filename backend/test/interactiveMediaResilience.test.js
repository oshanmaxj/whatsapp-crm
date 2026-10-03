const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');
const { InteractiveMediaService } = require('../src/services/interactiveMedia.service');
const interactiveMediaService = require('../src/services/interactiveMedia.service');
const flowService = require('../src/services/flow.service');
const whatsappService = require('../src/services/whatsapp.service');
const outboundHistoryService = require('../src/services/outboundHistory.service');
const messagingWindowService = require('../src/services/messagingWindow.service');
const logger = require('../src/config/logger');

const PRIVATE_ROOT = path.join(__dirname, '../private/flow-media');
const jpeg = (suffix) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
  Buffer.from(suffix || 'a')
]);

async function listObjectFiles() {
  const objectsDir = path.join(PRIVATE_ROOT, 'objects');
  const shards = await fsp.readdir(objectsDir).catch(() => []);
  const files = [];
  for (const shard of shards) {
    const shardFiles = await fsp.readdir(path.join(objectsDir, shard)).catch(() => []);
    files.push(...shardFiles.map((name) => path.join(shard, name)));
  }
  return files;
}

test.after(async () => {
  await fsp.rm(path.join(PRIVATE_ROOT, 'objects'), { recursive: true, force: true });
  await fsp.rm(path.join(PRIVATE_ROOT, 'test-resilience'), { recursive: true, force: true });
});

// --- 3: content-addressed dedup -------------------------------------------

test('identical content uploaded twice does not create a second physical file', async () => {
  let uploadCalls = 0;
  const service = new InteractiveMediaService({
    whatsappService: { uploadMedia: async () => { uploadCalls += 1; return { id: `meta-${uploadCalls}` }; } }
  });
  const buffer = jpeg('dedup-same-bytes');
  const before = await listObjectFiles();
  const first = await service.storeAndUpload({ dataBase64: buffer.toString('base64'), fileName: 'a.jpg', mimeType: 'image/jpeg', mediaType: 'image', whatsappAccountId: 7 });
  const afterFirst = await listObjectFiles();
  const second = await service.storeAndUpload({ dataBase64: buffer.toString('base64'), fileName: 'renamed-but-same-bytes.jpg', mimeType: 'image/jpeg', mediaType: 'image', whatsappAccountId: 7 });
  const afterSecond = await listObjectFiles();
  assert.equal(first.localMediaRef, second.localMediaRef, 'identical bytes must resolve to the same stored object');
  assert.equal(afterFirst.length, before.length + 1, 'the first upload creates exactly one new physical file');
  assert.equal(afterSecond.length, afterFirst.length, 'the second upload of identical bytes creates no additional physical file');
  assert.equal(uploadCalls, 2, 'each binding still gets its own Meta upload call even when the physical file is reused');
  // The original filename is preserved separately from the shared storage object.
  assert.equal(second.fileName, 'renamed-but-same-bytes.jpg');
});

test('different content always creates a different stored object', async () => {
  const service = new InteractiveMediaService({ whatsappService: { uploadMedia: async () => ({ id: 'meta-x' }) } });
  const a = await service.storeAndUpload({ dataBase64: jpeg('content-a').toString('base64'), fileName: 'a.jpg', mimeType: 'image/jpeg', mediaType: 'image', whatsappAccountId: 7 });
  const b = await service.storeAndUpload({ dataBase64: jpeg('content-b').toString('base64'), fileName: 'b.jpg', mimeType: 'image/jpeg', mediaType: 'image', whatsappAccountId: 7 });
  assert.notEqual(a.localMediaRef, b.localMediaRef);
});

test('concurrent uploads of identical bytes are safe and resolve to one shared object', async () => {
  const service = new InteractiveMediaService({ whatsappService: { uploadMedia: async () => ({ id: 'meta-race' }) } });
  const buffer = jpeg('race-condition-bytes');
  const [a, b, c] = await Promise.all([
    service.storeAndUpload({ dataBase64: buffer.toString('base64'), fileName: 'r.jpg', mimeType: 'image/jpeg', mediaType: 'image', whatsappAccountId: 7 }),
    service.storeAndUpload({ dataBase64: buffer.toString('base64'), fileName: 'r.jpg', mimeType: 'image/jpeg', mediaType: 'image', whatsappAccountId: 7 }),
    service.storeAndUpload({ dataBase64: buffer.toString('base64'), fileName: 'r.jpg', mimeType: 'image/jpeg', mediaType: 'image', whatsappAccountId: 7 })
  ]);
  assert.equal(a.localMediaRef, b.localMediaRef);
  assert.equal(b.localMediaRef, c.localMediaRef);
  const filePath = interactiveMediaService.resolvePrivatePath(a.localMediaRef);
  const stat = await fsp.stat(filePath);
  assert.equal(stat.size, buffer.length, 'the file at the shared path is intact, not corrupted by the concurrent writers');
});

test('a Meta upload failure never deletes a content-addressed object another binding may already reference', async () => {
  const buffer = jpeg('shared-then-fails');
  const okService = new InteractiveMediaService({ whatsappService: { uploadMedia: async () => ({ id: 'meta-ok' }) } });
  const stored = await okService.storeAndUpload({ dataBase64: buffer.toString('base64'), fileName: 's.jpg', mimeType: 'image/jpeg', mediaType: 'image', whatsappAccountId: 7 });
  const failingService = new InteractiveMediaService({ whatsappService: { uploadMedia: async () => { throw new Error('Meta rejected this upload'); } } });
  await assert.rejects(
    failingService.storeAndUpload({ dataBase64: buffer.toString('base64'), fileName: 's.jpg', mimeType: 'image/jpeg', mediaType: 'image', whatsappAccountId: 9 }),
    /Meta rejected this upload/
  );
  const filePath = interactiveMediaService.resolvePrivatePath(stored.localMediaRef);
  const stat = await fsp.stat(filePath).catch(() => null);
  assert.ok(stat?.isFile(), 'the pre-existing shared object must still be present after an unrelated upload attempt fails');
});

// --- legacy compatibility --------------------------------------------------

test('a legacy random-UUID localMediaRef (from before content-addressing) still resolves and uploads normally', async () => {
  const legacyRelative = path.join('test-resilience', 'legacy-scope', `${crypto.randomUUID()}-legacy.jpg`);
  const legacyPath = interactiveMediaService.resolvePrivatePath(legacyRelative);
  const buffer = jpeg('legacy-file-bytes');
  await fsp.mkdir(path.dirname(legacyPath), { recursive: true });
  await fsp.writeFile(legacyPath, buffer);
  const service = new InteractiveMediaService({ whatsappService: { uploadMedia: async (input) => { assert.equal(input.filePath, legacyPath); return { id: 'meta-legacy' }; } } });
  const result = await service.uploadStored({ localMediaRef: legacyRelative.split(path.sep).join('/'), mediaType: 'image', mimeType: 'image/jpeg', size: buffer.length, fileName: 'legacy.jpg' }, 7);
  assert.equal(result.mediaId, 'meta-legacy');
});

// --- 1: resolveStored() resilience -----------------------------------------

test('resolveStored reuses a valid Meta media ID without re-uploading', async () => {
  let getMediaUrlCalls = 0;
  let uploadCalls = 0;
  const service = new InteractiveMediaService({
    whatsappService: {
      getRuntimeConfig: async (id) => ({ whatsappAccountId: id }),
      getMediaUrl: async () => { getMediaUrlCalls += 1; return { mime_type: 'image/jpeg', file_size: 100 }; },
      uploadMedia: async () => { uploadCalls += 1; return { id: 'should-not-be-called' }; }
    }
  });
  const result = await service.resolveStored({
    mediaId: 'meta-valid', whatsappAccountId: 7, localMediaRef: 'flow/x/y.jpg',
    mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg'
  }, 7);
  assert.equal(result.mediaId, 'meta-valid', 'the existing media ID is reused, not replaced');
  assert.equal(getMediaUrlCalls, 1, 'the Meta media ID is verified before being trusted');
  assert.equal(uploadCalls, 0, 'a valid media ID is never re-uploaded');
});

// The ONE structured Meta error shape this repository already has evidence
// for as meaning "this media reference is invalid/unavailable" — the exact
// code/subcode pairing flowMessageHistory.test.js and
// whatsappInteractiveMedia.test.js already use for a rejected media
// parameter. This is deliberately NOT subcode 33: that pairing (code 100 +
// subcode 33) already means something else entirely in this same codebase
// — see whatsapp.service.js / whatsappAccount.service.js, where it means
// "phone number not accessible with this token" (an account/permission
// problem) — so it must NOT be (mis)used here to mean "media unavailable".
function metaMediaNotFoundError() {
  return Object.assign(new Error('Invalid media parameter'), {
    response: { status: 400, data: { error: { code: 100, error_subcode: 2494010, message: 'Invalid media parameter' } } }
  });
}
// The repo's own established meaning for this exact pairing: an
// account/token-accessibility problem, not a media problem (see comment
// above). Used to prove the classifier does not conflate the two.
function metaPhoneNumberInaccessibleError() {
  return Object.assign(new Error('Configured phone number ID is not accessible with the configured token.'), {
    response: { status: 400, data: { error: { code: 100, error_subcode: 33, message: 'Unsupported post request' } } }
  });
}
function metaUnknownSubcodeError() {
  return Object.assign(new Error('Unknown media parameter issue'), {
    response: { status: 400, data: { error: { code: 100, error_subcode: 9999999, message: 'Some other code-100 problem' } } }
  });
}
function genericUnknown400Error() {
  return Object.assign(new Error('Bad request'), {
    response: { status: 400, data: { error: { message: 'Bad request' } } }
  });
}
function metaAuthError() {
  return Object.assign(new Error('Invalid OAuth access token'), {
    response: { status: 401, data: { error: { code: 190, type: 'OAuthException', message: 'Error validating access token' } } }
  });
}
function metaPermissionError() {
  return Object.assign(new Error('Permission denied'), {
    response: { status: 403, data: { error: { code: 10, type: 'OAuthException', message: 'Application does not have permission for this action' } } }
  });
}
function metaRateLimitError() {
  return Object.assign(new Error('Too many calls'), {
    response: { status: 429, data: { error: { code: 4, type: 'OAuthException', message: 'Application request limit reached' } } }
  });
}
function networkTimeoutError() {
  // A real axios timeout/ECONNRESET/DNS failure never populates
  // error.response at all — there was no server response to carry a status.
  return Object.assign(new Error('timeout of 20000ms exceeded'), { code: 'ECONNABORTED' });
}
function metaServerError() {
  return Object.assign(new Error('Internal server error'), {
    response: { status: 503, data: { error: { message: 'Service unavailable' } } }
  });
}

test('resolveStored automatically re-uploads from the local copy when the Meta media ID is expired, and returns the refreshed ID', async () => {
  const service = new InteractiveMediaService({
    whatsappService: {
      getRuntimeConfig: async (id) => ({ whatsappAccountId: id }),
      getMediaUrl: async () => { throw metaMediaNotFoundError(); },
      uploadMedia: async (input) => { assert.equal(input.whatsappAccountId, 7); return { id: 'meta-refreshed' }; }
    }
  });
  const stat = { isFile: () => true, size: 100 };
  const originalStat = fsp.stat;
  fsp.stat = async () => stat;
  try {
    const result = await service.resolveStored({
      mediaId: 'meta-expired', whatsappAccountId: 7, localMediaRef: 'flow/x/y.jpg',
      mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg'
    }, 7);
    assert.equal(result.mediaId, 'meta-refreshed', 'the caller receives the fresh media ID, not the expired one');
  } finally {
    fsp.stat = originalStat;
  }
});

test('resolveStored does not hide an unrelated re-upload failure behind the expiry fallback', async () => {
  const service = new InteractiveMediaService({
    whatsappService: {
      getRuntimeConfig: async (id) => ({ whatsappAccountId: id }),
      getMediaUrl: async () => { throw metaMediaNotFoundError(); },
      uploadMedia: async () => { throw Object.assign(new Error('Meta rejected this file as malformed'), { code: 'META_REJECTED' }); }
    }
  });
  const originalStat = fsp.stat;
  fsp.stat = async () => ({ isFile: () => true, size: 100 });
  try {
    await assert.rejects(
      service.resolveStored({ mediaId: 'meta-expired', whatsappAccountId: 7, localMediaRef: 'flow/x/y.jpg', mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg' }, 7),
      (error) => error.message === 'Meta rejected this file as malformed' && error.code === 'META_REJECTED'
    );
  } finally {
    fsp.stat = originalStat;
  }
});

// --- error classification: only a genuine media-unavailable rejection may trigger a re-upload ---

test('code 100 with an unrelated/unknown subcode never triggers a re-upload', async () => {
  let uploadCalls = 0;
  const service = new InteractiveMediaService({
    whatsappService: {
      getRuntimeConfig: async (id) => ({ whatsappAccountId: id }),
      getMediaUrl: async () => { throw metaUnknownSubcodeError(); },
      uploadMedia: async () => { uploadCalls += 1; return { id: 'should-not-happen' }; }
    }
  });
  await assert.rejects(
    service.resolveStored({ mediaId: 'meta-x', whatsappAccountId: 7, localMediaRef: 'flow/x/y.jpg', mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg' }, 7),
    (error) => error.message === 'Unknown media parameter issue'
  );
  assert.equal(uploadCalls, 0, 'only the one specific evidenced subcode (2494010) is allow-listed; any other code-100 subcode is not assumed to mean the same thing');
});

test('a generic unknown HTTP 400 (no recognizable Meta error code at all) never triggers a re-upload', async () => {
  let uploadCalls = 0;
  const service = new InteractiveMediaService({
    whatsappService: {
      getRuntimeConfig: async (id) => ({ whatsappAccountId: id }),
      getMediaUrl: async () => { throw genericUnknown400Error(); },
      uploadMedia: async () => { uploadCalls += 1; return { id: 'should-not-happen' }; }
    }
  });
  await assert.rejects(
    service.resolveStored({ mediaId: 'meta-x', whatsappAccountId: 7, localMediaRef: 'flow/x/y.jpg', mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg' }, 7),
    (error) => error.message === 'Bad request'
  );
  assert.equal(uploadCalls, 0, 'an unclassified error must propagate, not be assumed to mean the media is gone');
});

test('the repo\'s own "phone number not accessible with this token" shape (code 100 + subcode 33) is never treated as a media problem', async () => {
  let uploadCalls = 0;
  const service = new InteractiveMediaService({
    whatsappService: {
      getRuntimeConfig: async (id) => ({ whatsappAccountId: id }),
      getMediaUrl: async () => { throw metaPhoneNumberInaccessibleError(); },
      uploadMedia: async () => { uploadCalls += 1; return { id: 'should-not-happen' }; }
    }
  });
  await assert.rejects(
    service.resolveStored({ mediaId: 'meta-x', whatsappAccountId: 7, localMediaRef: 'flow/x/y.jpg', mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg' }, 7),
    (error) => error.message === 'Configured phone number ID is not accessible with the configured token.'
  );
  assert.equal(uploadCalls, 0, 'this exact code/subcode pairing already means an account/token problem elsewhere in this codebase, not a media problem');
});

test('an authentication/token failure during verification never triggers a re-upload — the original error propagates', async () => {
  let uploadCalls = 0;
  const service = new InteractiveMediaService({
    whatsappService: {
      getRuntimeConfig: async (id) => ({ whatsappAccountId: id }),
      getMediaUrl: async () => { throw metaAuthError(); },
      uploadMedia: async () => { uploadCalls += 1; return { id: 'should-not-happen' }; }
    }
  });
  await assert.rejects(
    service.resolveStored({ mediaId: 'meta-x', whatsappAccountId: 7, localMediaRef: 'flow/x/y.jpg', mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg' }, 7),
    (error) => error.message === 'Invalid OAuth access token'
  );
  assert.equal(uploadCalls, 0, 'an auth failure says nothing about the media itself; it must not trigger a re-upload');
});

test('a permission failure during verification never triggers a re-upload', async () => {
  let uploadCalls = 0;
  const service = new InteractiveMediaService({
    whatsappService: {
      getRuntimeConfig: async (id) => ({ whatsappAccountId: id }),
      getMediaUrl: async () => { throw metaPermissionError(); },
      uploadMedia: async () => { uploadCalls += 1; return { id: 'should-not-happen' }; }
    }
  });
  await assert.rejects(
    service.resolveStored({ mediaId: 'meta-x', whatsappAccountId: 7, localMediaRef: 'flow/x/y.jpg', mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg' }, 7),
    (error) => error.message === 'Permission denied'
  );
  assert.equal(uploadCalls, 0);
});

test('a rate-limit failure during verification never triggers a re-upload', async () => {
  let uploadCalls = 0;
  const service = new InteractiveMediaService({
    whatsappService: {
      getRuntimeConfig: async (id) => ({ whatsappAccountId: id }),
      getMediaUrl: async () => { throw metaRateLimitError(); },
      uploadMedia: async () => { uploadCalls += 1; return { id: 'should-not-happen' }; }
    }
  });
  await assert.rejects(
    service.resolveStored({ mediaId: 'meta-x', whatsappAccountId: 7, localMediaRef: 'flow/x/y.jpg', mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg' }, 7),
    (error) => error.message === 'Too many calls'
  );
  assert.equal(uploadCalls, 0, 'rate limiting is transient and unrelated to whether the media itself is valid');
});

test('a network timeout during verification never triggers a re-upload', async () => {
  let uploadCalls = 0;
  const service = new InteractiveMediaService({
    whatsappService: {
      getRuntimeConfig: async (id) => ({ whatsappAccountId: id }),
      getMediaUrl: async () => { throw networkTimeoutError(); },
      uploadMedia: async () => { uploadCalls += 1; return { id: 'should-not-happen' }; }
    }
  });
  await assert.rejects(
    service.resolveStored({ mediaId: 'meta-x', whatsappAccountId: 7, localMediaRef: 'flow/x/y.jpg', mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg' }, 7),
    (error) => error.message === 'timeout of 20000ms exceeded'
  );
  assert.equal(uploadCalls, 0, 'a connectivity failure never reached Meta at all, so it cannot mean the media is gone');
});

test('a generic 5xx server error during verification never triggers a re-upload', async () => {
  let uploadCalls = 0;
  const service = new InteractiveMediaService({
    whatsappService: {
      getRuntimeConfig: async (id) => ({ whatsappAccountId: id }),
      getMediaUrl: async () => { throw metaServerError(); },
      uploadMedia: async () => { uploadCalls += 1; return { id: 'should-not-happen' }; }
    }
  });
  await assert.rejects(
    service.resolveStored({ mediaId: 'meta-x', whatsappAccountId: 7, localMediaRef: 'flow/x/y.jpg', mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg' }, 7),
    (error) => error.message === 'Internal server error'
  );
  assert.equal(uploadCalls, 0);
});

test('resolveStored with no local copy at all preserves the existing explicit-trust behavior (no verification attempted)', async () => {
  let getMediaUrlCalls = 0;
  const service = new InteractiveMediaService({
    whatsappService: { getMediaUrl: async () => { getMediaUrlCalls += 1; return {}; } }
  });
  const result = await service.resolveStored({ mediaId: 'meta-trusted', whatsappAccountId: 7, localMediaRef: null, mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg' }, 7);
  assert.equal(result.mediaId, 'meta-trusted');
  assert.equal(getMediaUrlCalls, 0, 'with nothing to fall back to, behavior is unchanged: no verification call is made');
});

test('resolveStored still produces the explicit missing-media error when there is neither a media ID nor a local copy', async () => {
  const service = new InteractiveMediaService({ whatsappService: {} });
  await assert.rejects(
    service.resolveStored({ mediaId: null, localMediaRef: null }, 7),
    { code: 'INTERACTIVE_MEDIA_MISSING' }
  );
});

test('resolveStored account mismatch with no local copy returns the binding unchanged, matching its pre-existing (unaltered) behavior', async () => {
  // Tracing the pre-existing branch structure this change deliberately left
  // untouched: with no localMediaRef, the very first condition
  // (`!normalized.localMediaRef`) is already true, so this always falls
  // into the blind-trust return — the same as the "no local copy at all"
  // case above — regardless of whether the account matches. The
  // ACCOUNT_MISMATCH error below it is only reachable when neither a
  // mediaId's account matches nor a localMediaRef exists to fall back on,
  // which by this same logic never actually occurs; that was true before
  // this fix and remains true now, since this specific branch was not
  // changed.
  const service = new InteractiveMediaService({ whatsappService: {} });
  const result = await service.resolveStored({ mediaId: 'meta-1', whatsappAccountId: 9, localMediaRef: null }, 7);
  assert.equal(result.mediaId, 'meta-1');
});

test('resolveStored account mismatch WITH a local copy re-uploads fresh for the requested account, without attempting Meta verification under the wrong account', async () => {
  let getMediaUrlCalls = 0;
  const service = new InteractiveMediaService({
    whatsappService: {
      getMediaUrl: async () => { getMediaUrlCalls += 1; return {}; },
      uploadMedia: async (input) => { assert.equal(input.whatsappAccountId, 7); return { id: 'meta-new-account' }; }
    }
  });
  const originalStat = fsp.stat;
  fsp.stat = async () => ({ isFile: () => true, size: 100 });
  try {
    const result = await service.resolveStored({ mediaId: 'meta-old-account', whatsappAccountId: 9, localMediaRef: 'flow/x/y.jpg', mimeType: 'image/jpeg', size: 100, fileName: 'y.jpg' }, 7);
    assert.equal(result.mediaId, 'meta-new-account');
    assert.equal(getMediaUrlCalls, 0, 'verifying a media ID that belongs to a different account would be meaningless');
  } finally {
    fsp.stat = originalStat;
  }
});

// --- 2: FlowNode configJson persistence ------------------------------------

test('a standalone media node that auto-refreshes an expired media ID persists the new binding onto FlowNode.configJson', async () => {
  const originals = {
    resolveStored: interactiveMediaService.resolveStored,
    send: whatsappService.sendMediaMessage,
    prepare: outboundHistoryService.prepare,
    complete: outboundHistoryService.complete,
    fail: outboundHistoryService.fail,
    authorize: messagingWindowService.authorizeSessionMessage
  };
  let updateCalls = 0;
  let lastUpdatePayload = null;
  const historyMessage = { id: 201, rawPayload: {}, update: async () => {} };
  messagingWindowService.authorizeSessionMessage = async () => ({ allowed: true });
  interactiveMediaService.resolveStored = async () => ({
    mediaId: 'meta-refreshed', whatsappAccountId: '7', localMediaRef: 'flow/execution/x.jpg',
    mimeType: 'image/jpeg', size: 200, fileName: 'x.jpg'
  });
  outboundHistoryService.prepare = async (payload) => ({ message: historyMessage, conversation: { id: 3 }, payload });
  outboundHistoryService.complete = async () => {};
  outboundHistoryService.fail = async () => {};
  whatsappService.sendMediaMessage = async () => ({ id: 'wamid-media-1' });
  const config = {
    whatsappMediaId: 'meta-expired-old', mediaAccountId: 7, mediaLocalRef: 'flow/execution/old.jpg',
    mimeType: 'image/jpeg', mediaSize: 100, fileName: 'old.jpg'
  };
  const node = {
    nodeKey: 'media1', nodeType: 'image_message',
    update: async (patch) => { updateCalls += 1; lastUpdatePayload = patch; }
  };
  try {
    const output = await flowService.executeMessageNode(node, config, {
      flowId: 1, conversationId: 3, contactId: 2, contact: { phone: '94770000000' }, whatsappAccountId: 7
    }, true);
    assert.equal(output.response.id, 'wamid-media-1');
    assert.equal(updateCalls, 1, 'configJson is persisted exactly once when the binding actually changed');
    assert.equal(lastUpdatePayload.configJson.whatsappMediaId, 'meta-refreshed');
    assert.equal(lastUpdatePayload.configJson.mediaAccountId, '7');
    assert.equal(lastUpdatePayload.configJson.mediaLocalRef, 'flow/execution/x.jpg');
    assert.equal(lastUpdatePayload.configJson.mediaSize, 200);
    assert.equal(lastUpdatePayload.configJson.fileName, 'x.jpg');
  } finally {
    interactiveMediaService.resolveStored = originals.resolveStored;
    whatsappService.sendMediaMessage = originals.send;
    outboundHistoryService.prepare = originals.prepare;
    outboundHistoryService.complete = originals.complete;
    outboundHistoryService.fail = originals.fail;
    messagingWindowService.authorizeSessionMessage = originals.authorize;
  }
});

test('a standalone media node does NOT persist configJson when resolveStored returns the same media ID unchanged', async () => {
  const originals = {
    resolveStored: interactiveMediaService.resolveStored,
    send: whatsappService.sendMediaMessage,
    prepare: outboundHistoryService.prepare,
    complete: outboundHistoryService.complete,
    fail: outboundHistoryService.fail,
    authorize: messagingWindowService.authorizeSessionMessage
  };
  let updateCalls = 0;
  const historyMessage = { id: 202, rawPayload: {}, update: async () => {} };
  messagingWindowService.authorizeSessionMessage = async () => ({ allowed: true });
  interactiveMediaService.resolveStored = async (binding) => ({ ...binding }); // unchanged mediaId
  outboundHistoryService.prepare = async (payload) => ({ message: historyMessage, conversation: { id: 3 }, payload });
  outboundHistoryService.complete = async () => {};
  outboundHistoryService.fail = async () => {};
  whatsappService.sendMediaMessage = async () => ({ id: 'wamid-media-2' });
  const node = { nodeKey: 'media2', nodeType: 'image_message', update: async () => { updateCalls += 1; } };
  try {
    await flowService.executeMessageNode(node, {
      whatsappMediaId: 'meta-still-valid', mediaAccountId: 7, mediaLocalRef: 'flow/execution/y.jpg',
      mimeType: 'image/jpeg', mediaSize: 100, fileName: 'y.jpg'
    }, { flowId: 1, conversationId: 3, contactId: 2, contact: { phone: '94770000000' }, whatsappAccountId: 7 }, true);
    assert.equal(updateCalls, 0, 'nothing changed, so FlowNode is never written to');
  } finally {
    interactiveMediaService.resolveStored = originals.resolveStored;
    whatsappService.sendMediaMessage = originals.send;
    outboundHistoryService.prepare = originals.prepare;
    outboundHistoryService.complete = originals.complete;
    outboundHistoryService.fail = originals.fail;
    messagingWindowService.authorizeSessionMessage = originals.authorize;
  }
});

test('when persisting the refreshed media binding fails, a warning is logged (with safe identifiers only) and the current execution still sends successfully using the refreshed binding', async () => {
  const originals = {
    resolveStored: interactiveMediaService.resolveStored,
    send: whatsappService.sendMediaMessage,
    prepare: outboundHistoryService.prepare,
    complete: outboundHistoryService.complete,
    fail: outboundHistoryService.fail,
    authorize: messagingWindowService.authorizeSessionMessage,
    warn: logger.warn
  };
  const warnings = [];
  const historyMessage = { id: 203, rawPayload: {}, update: async () => {} };
  const secretToken = 'super-secret-access-token-should-never-be-logged';
  messagingWindowService.authorizeSessionMessage = async () => ({ allowed: true });
  interactiveMediaService.resolveStored = async () => ({
    mediaId: 'meta-refreshed-but-unsaved', whatsappAccountId: '7', localMediaRef: 'flow/execution/secret-content.jpg',
    mimeType: 'image/jpeg', size: 200, fileName: 'x.jpg'
  });
  outboundHistoryService.prepare = async (payload) => ({ message: historyMessage, conversation: { id: 3 }, payload });
  outboundHistoryService.complete = async () => {};
  outboundHistoryService.fail = async () => {};
  whatsappService.sendMediaMessage = async () => ({ id: 'wamid-media-3', accessToken: secretToken });
  logger.warn = (event, metadata) => warnings.push({ event, metadata });
  const node = {
    nodeKey: 'media3', nodeType: 'image_message',
    update: async () => { throw Object.assign(new Error('could not serialize access due to concurrent update'), { code: '40001' }); }
  };
  try {
    const output = await flowService.executeMessageNode(node, {
      whatsappMediaId: 'meta-expired-old', mediaAccountId: 7, mediaLocalRef: 'flow/execution/secret-content.jpg',
      mimeType: 'image/jpeg', mediaSize: 100, fileName: 'old.jpg'
    }, { flowId: 42, conversationId: 3, contactId: 2, contact: { phone: '94770000000' }, whatsappAccountId: 7 }, true);
    assert.equal(output.response.id, 'wamid-media-3', 'the message still sends successfully with the refreshed binding, regardless of the persistence failure');
    assert.equal(warnings.length, 1, 'the persistence failure is observable, not silently discarded');
    assert.equal(warnings[0].event, 'flow_media_binding_persist_failed');
    assert.equal(warnings[0].metadata.flowId, 42);
    assert.equal(warnings[0].metadata.nodeKey, 'media3');
    assert.equal(warnings[0].metadata.errorCode, '40001');
    assert.match(warnings[0].metadata.errorMessage, /concurrent update/);
    const serializedLog = JSON.stringify(warnings[0]);
    assert.doesNotMatch(serializedLog, new RegExp(secretToken), 'no token/credential ever appears in the log');
    assert.doesNotMatch(serializedLog, /secret-content\.jpg/, 'no media path/filename/URL appears in the log');
    assert.doesNotMatch(serializedLog, /configJson|mediaLocalRef|mimeType/, 'the config object itself is never logged, only safe identifiers');
  } finally {
    interactiveMediaService.resolveStored = originals.resolveStored;
    whatsappService.sendMediaMessage = originals.send;
    outboundHistoryService.prepare = originals.prepare;
    outboundHistoryService.complete = originals.complete;
    outboundHistoryService.fail = originals.fail;
    messagingWindowService.authorizeSessionMessage = originals.authorize;
    logger.warn = originals.warn;
  }
});
