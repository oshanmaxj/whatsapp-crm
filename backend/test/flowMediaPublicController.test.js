const os = require('os');
const fs = require('fs');
const path = require('path');
const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');

const TEMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-media-controller-test-'));
process.env.FLOW_MEDIA_PRIVATE_ROOT = TEMP_ROOT;

const resolver = require('../src/services/facebookMediaUrlResolver.service');
const controller = require('../src/controllers/flowMediaPublic.controller');

after(() => { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); });

function writeFile(relativePath, content) {
  const full = path.join(TEMP_ROOT, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

const { EventEmitter } = require('events');

function fakeRes() {
  const headers = {};
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: 200,
    ended: false,
    body: Buffer.alloc(0),
    headers,
    headersSent: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { headers[String(name).toLowerCase()] = value; },
    json(payload) { this.jsonBody = payload; this.ended = true; return this; },
    write(chunk) { this.body = Buffer.concat([this.body, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]); return true; },
    end(chunk) { if (chunk) this.write(chunk); this.ended = true; this.emit('finish'); },
    destroy() { this.ended = true; this.destroyed = true; }
  });
  return res;
}

async function tokenFor(relativePath, mimeType, content, mediaType = 'image') {
  writeFile(relativePath, content);
  const result = await resolver.resolveForMessenger({ mediaType, config: { mediaLocalRef: relativePath, mimeType } });
  return result.url.slice(result.url.lastIndexOf('/') + 1);
}

test('a valid token serves the exact bytes with the correct Content-Type', async () => {
  const content = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const token = await tokenFor('flow/1/photo.jpg', 'image/jpeg', content);
  const res = fakeRes();
  await controller.serve({ params: { token }, method: 'GET' }, res);
  assert.equal(res.headers['content-type'], 'image/jpeg');
  assert.equal(res.headers['content-length'], String(content.length));
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.ok(res.body.equals(content), 'the served bytes must exactly match the stored file');
});

test('a HEAD request returns headers with no body', async () => {
  const content = Buffer.from([1, 2, 3, 4]);
  const token = await tokenFor('flow/1/clip.mp4', 'video/mp4', content, 'video');
  const res = fakeRes();
  await controller.serve({ params: { token }, method: 'HEAD' }, res);
  assert.equal(res.headers['content-type'], 'video/mp4');
  assert.equal(res.body.length, 0);
  assert.ok(res.ended);
});

test('an invalid/garbage token returns 404, not an error leaking internals', async () => {
  const res = fakeRes();
  await controller.serve({ params: { token: 'not-a-real-token' }, method: 'GET' }, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.jsonBody.success, false);
});

test('a well-formed but never-issued token (forged payload/signature pair) returns 404', async () => {
  const forged = `${Buffer.from('flow/1/never-existed.jpg|image/jpeg|9999999999999', 'utf8').toString('base64url')}.notarealsignature`;
  const res = fakeRes();
  await controller.serve({ params: { token: forged }, method: 'GET' }, res);
  assert.equal(res.statusCode, 404);
});

test('a token minted (via a bypassed check) for a file outside the private root is still refused by the controller\'s own path guard', async () => {
  // Simulates defense-in-depth: even if something upstream ever signed a bad
  // reference, the controller independently re-validates via
  // interactiveMediaService.resolvePrivatePath before touching the filesystem.
  const token = resolver.mintPublicMediaToken('/etc/passwd', 'text/plain');
  const res = fakeRes();
  await controller.serve({ params: { token }, method: 'GET' }, res);
  assert.equal(res.statusCode, 404);
});

test('a token for a file that no longer exists on disk returns 404', async () => {
  const token = resolver.mintPublicMediaToken('flow/1/deleted-after-mint.jpg', 'image/jpeg');
  const res = fakeRes();
  await controller.serve({ params: { token }, method: 'GET' }, res);
  assert.equal(res.statusCode, 404);
});
