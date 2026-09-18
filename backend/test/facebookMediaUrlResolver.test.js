const os = require('os');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

// Must be set BEFORE interactiveMedia.service.js is first required anywhere
// in this process, since it reads FLOW_MEDIA_PRIVATE_ROOT once at module
// load time. node:test runs each test file in its own process, so this
// cannot leak into other test files.
const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-media-resolver-test-'));
process.env.FLOW_MEDIA_PRIVATE_ROOT = TEMP_ROOT;

const resolver = require('../src/services/facebookMediaUrlResolver.service');
const facebookSettingsService = require('../src/services/facebookSettings.service');

after(() => { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); });

function writeFile(relativePath, content = Buffer.from([0xff, 0xd8, 0xff, 0xe0])) {
  const full = path.join(TEMP_ROOT, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

test('an existing public HTTPS URL is used as-is (existing_https strategy)', async () => {
  const result = await resolver.resolveForMessenger({
    mediaType: 'image', config: { imageUrl: 'https://cdn.example.com/pic.jpg' }
  });
  assert.equal(result.strategy, 'existing_https');
  assert.equal(result.url, 'https://cdn.example.com/pic.jpg');
});

test('a data: URL is never treated as usable, even if present', async () => {
  await assert.rejects(
    resolver.resolveForMessenger({ mediaType: 'image', config: { imageUrl: 'data:image/png;base64,aaaa' } }),
    (error) => error.code === 'FACEBOOK_MEDIA_URL_REQUIRED'
  );
});

test('a non-HTTPS or localhost URL is rejected with a clear reason', async () => {
  await assert.rejects(
    resolver.resolveForMessenger({ mediaType: 'video', config: { mediaUrl: 'http://cdn.example.com/clip.mp4' } }),
    (error) => error.code === 'FACEBOOK_MEDIA_URL_INVALID'
  );
  await assert.rejects(
    resolver.resolveForMessenger({ mediaType: 'video', config: { mediaUrl: 'https://localhost/clip.mp4' } }),
    (error) => error.code === 'FACEBOOK_MEDIA_URL_INVALID'
  );
});

test('a Flow-Builder-uploaded (WhatsApp) local file resolves to a signed public CRM URL', async () => {
  writeFile('flow/95/abc-photo.jpg');
  const config = { mediaLocalRef: 'flow/95/abc-photo.jpg', mimeType: 'image/jpeg', whatsappMediaId: 'wamid-123', mediaAccountId: '2' };
  const result = await resolver.resolveForMessenger({ mediaType: 'image', config, flowId: 95, flowRunId: 501, nodeId: 'img1' });
  assert.equal(result.strategy, 'crm_media_public_url');
  const expectedBase = `${facebookSettingsService.publicBaseUrl()}${resolver.PUBLIC_PATH_PREFIX}/`;
  assert.ok(result.url.startsWith(expectedBase), `expected url to start with ${expectedBase}, got ${result.url}`);
  const token = result.url.slice(expectedBase.length);
  const verified = resolver.verifyPublicMediaToken(token);
  assert.ok(verified, 'the minted token must verify successfully');
  assert.equal(verified.relativePath, 'flow/95/abc-photo.jpg');
  assert.equal(verified.mimeType, 'image/jpeg');
});

test('video, audio and document local uploads all resolve the same way', async () => {
  const cases = [
    { mediaType: 'video', ref: 'flow/95/clip.mp4', mime: 'video/mp4' },
    { mediaType: 'audio', ref: 'flow/95/voice.aac', mime: 'audio/aac' },
    { mediaType: 'document', ref: 'flow/95/brochure.pdf', mime: 'application/pdf' }
  ];
  for (const item of cases) {
    writeFile(item.ref);
    const result = await resolver.resolveForMessenger({ mediaType: item.mediaType, config: { mediaLocalRef: item.ref, mimeType: item.mime } });
    assert.equal(result.strategy, 'crm_media_public_url', `${item.mediaType} should resolve via crm_media_public_url`);
  }
});

test('a missing local file fails safely with a clear, path-free error', async () => {
  await assert.rejects(
    resolver.resolveForMessenger({ mediaType: 'image', config: { mediaLocalRef: 'flow/95/never-written.jpg', mimeType: 'image/jpeg' } }),
    (error) => {
      assert.equal(error.code, 'FACEBOOK_MEDIA_FILE_MISSING');
      assert.ok(!/[\\/]flow-media-resolver-test-/.test(error.message), 'error message must never contain the real filesystem path');
      return true;
    }
  );
});

test('a relative ../.. traversal attempt can never escape the private root (it is contained, not followed, so it safely resolves to "missing" rather than an outside file)', async () => {
  // resolvePrivatePath() strips leading ".." segments and re-bases the
  // remainder inside PRIVATE_ROOT — proving containment, not merely
  // rejection: '../../../../etc/passwd' can only ever mean
  // '<PRIVATE_ROOT>/etc/passwd', which does not exist here.
  await assert.rejects(
    resolver.resolveForMessenger({ mediaType: 'document', config: { mediaLocalRef: '../../../../etc/passwd', mimeType: 'application/pdf' } }),
    (error) => error.code === 'FACEBOOK_MEDIA_FILE_MISSING'
  );
});

test('an absolute filesystem path reference is rejected outright, never resolved against another drive/root', async () => {
  await assert.rejects(
    resolver.resolveForMessenger({ mediaType: 'document', config: { mediaLocalRef: '/etc/passwd', mimeType: 'application/pdf' } }),
    (error) => error.code === 'FACEBOOK_MEDIA_REFERENCE_INVALID'
  );
});

test('an unsupported/mismatched MIME type for the claimed media type is rejected', async () => {
  writeFile('flow/95/weird.bin');
  await assert.rejects(
    resolver.resolveForMessenger({ mediaType: 'image', config: { mediaLocalRef: 'flow/95/weird.bin', mimeType: 'application/x-msdownload' } }),
    (error) => error.code === 'FACEBOOK_MEDIA_MIME_UNSUPPORTED'
  );
});

test('a WhatsApp-only media ID with no local copy is explained, not treated as a generic missing-URL error', async () => {
  await assert.rejects(
    resolver.resolveForMessenger({ mediaType: 'image', config: { whatsappMediaId: 'wamid-no-local-copy' } }),
    (error) => error.code === 'FACEBOOK_MEDIA_NOT_CONVERTIBLE'
  );
});

test('a node with no URL, no local ref, and no media ID at all still fails with FACEBOOK_MEDIA_URL_REQUIRED', async () => {
  await assert.rejects(
    resolver.resolveForMessenger({ mediaType: 'image', config: {} }),
    (error) => error.code === 'FACEBOOK_MEDIA_URL_REQUIRED'
  );
});

test('a tampered token (any byte changed) fails verification', async () => {
  writeFile('flow/95/tamper.jpg');
  const result = await resolver.resolveForMessenger({ mediaType: 'image', config: { mediaLocalRef: 'flow/95/tamper.jpg', mimeType: 'image/jpeg' } });
  const token = result.url.slice(result.url.lastIndexOf('/') + 1);
  const tampered = `${token.slice(0, -1)}${token.slice(-1) === 'a' ? 'b' : 'a'}`;
  assert.equal(resolver.verifyPublicMediaToken(tampered), null);
});

test('an expired token fails verification', async () => {
  const originalNow = Date.now;
  try {
    Date.now = () => originalNow() - (8 * 24 * 60 * 60 * 1000);
    writeFile('flow/95/old.jpg');
    const result = await resolver.resolveForMessenger({ mediaType: 'image', config: { mediaLocalRef: 'flow/95/old.jpg', mimeType: 'image/jpeg' } });
    const token = result.url.slice(result.url.lastIndexOf('/') + 1);
    Date.now = originalNow;
    assert.equal(resolver.verifyPublicMediaToken(token), null, 'a token minted 8 days ago must be expired under the 7-day TTL');
  } finally { Date.now = originalNow; }
});

// ---------------------------------------------------------------------------
// Explicit per-field tamper resistance: a valid token's signature covers the
// entire payload (path|mimeType|expiresAt) as one signed unit, so changing
// ANY single field while keeping the old signature must invalidate it. These
// three tests isolate each field individually, rather than relying only on
// the generic "any byte changed" test above.
// ---------------------------------------------------------------------------

function decodeToken(token) {
  const [payloadB64, mac] = String(token).split('.');
  const [relativePath, mimeType, expiresAt] = Buffer.from(payloadB64, 'base64url').toString('utf8').split('|');
  return { mac, relativePath, mimeType, expiresAt };
}

function encodePayload(relativePath, mimeType, expiresAt) {
  return Buffer.from(`${relativePath}|${mimeType}|${expiresAt}`, 'utf8').toString('base64url');
}

test('tampering: changing the signed path while keeping the original signature invalidates the token', async () => {
  writeFile('flow/95/original-path.jpg');
  writeFile('flow/95/attacker-target.jpg');
  const result = await resolver.resolveForMessenger({ mediaType: 'image', config: { mediaLocalRef: 'flow/95/original-path.jpg', mimeType: 'image/jpeg' } });
  const token = result.url.slice(result.url.lastIndexOf('/') + 1);
  const { mac, mimeType, expiresAt } = decodeToken(token);
  const forged = `${encodePayload('flow/95/attacker-target.jpg', mimeType, expiresAt)}.${mac}`;
  assert.equal(resolver.verifyPublicMediaToken(forged), null, 'the old signature must not validate a different path');
});

test('tampering: changing the signed MIME type while keeping the original signature invalidates the token', async () => {
  writeFile('flow/95/mime-swap.jpg');
  const result = await resolver.resolveForMessenger({ mediaType: 'image', config: { mediaLocalRef: 'flow/95/mime-swap.jpg', mimeType: 'image/jpeg' } });
  const token = result.url.slice(result.url.lastIndexOf('/') + 1);
  const { mac, relativePath, expiresAt } = decodeToken(token);
  const forged = `${encodePayload(relativePath, 'application/pdf', expiresAt)}.${mac}`;
  assert.equal(resolver.verifyPublicMediaToken(forged), null, 'the old signature must not validate a different Content-Type');
});

test('tampering: extending the signed expiry while keeping the original signature invalidates the token', async () => {
  writeFile('flow/95/expiry-extend.jpg');
  const result = await resolver.resolveForMessenger({ mediaType: 'image', config: { mediaLocalRef: 'flow/95/expiry-extend.jpg', mimeType: 'image/jpeg' } });
  const token = result.url.slice(result.url.lastIndexOf('/') + 1);
  const { mac, relativePath, mimeType, expiresAt } = decodeToken(token);
  const extendedExpiry = String(Number(expiresAt) + 365 * 24 * 60 * 60 * 1000);
  const forged = `${encodePayload(relativePath, mimeType, extendedExpiry)}.${mac}`;
  assert.equal(resolver.verifyPublicMediaToken(forged), null, 'the old signature must not validate an extended expiry');
});
