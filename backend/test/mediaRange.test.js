const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const mediaController = require('../src/controllers/media.controller');
const inboxService = require('../src/services/inbox.service');

async function download(range, { mediaType = 'video', mimeType = 'video/mp4', method = 'GET' } = {}) {
  const filePath = path.join(os.tmpdir(), `crm-media-range-${process.pid}-${Date.now()}.mp4`);
  await fsp.writeFile(filePath, Buffer.from('0123456789'));
  const original = inboxService.getMedia;
  inboxService.getMedia = async () => ({
    storagePath: filePath, originalName: mediaType === 'document' ? 'guide.pdf' : 'clip.mp4', mimeType, mediaType
  });
  const response = new PassThrough();
  response.headers = {};
  response.statusCode = 200;
  response.setHeader = (name, value) => { response.headers[name.toLowerCase()] = String(value); };
  response.set = (name, value) => { response.setHeader(name, value); return response; };
  response.status = (status) => { response.statusCode = status; return response; };
  const chunks = [];
  response.on('data', (chunk) => chunks.push(chunk));
  const finished = new Promise((resolve, reject) => {
    response.on('end', resolve);
    response.on('error', reject);
  });
  try {
    await mediaController.download(
      { params: { id: '1' }, user: { id: 1 }, method, headers: range ? { range } : {} },
      response,
      (error) => { throw error; }
    );
    await finished;
    return { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() };
  } finally {
    inboxService.getMedia = original;
    await fsp.unlink(filePath).catch(() => null);
  }
}

test('authenticated media download returns correct content headers', async () => {
  const result = await download();
  assert.equal(result.status, 200);
  assert.equal(result.headers['content-type'], 'video/mp4');
  assert.equal(result.headers['content-length'], '10');
  assert.equal(result.headers['accept-ranges'], 'bytes');
  assert.equal(result.headers['cache-control'], 'private, max-age=300, no-transform');
  assert.match(result.headers['content-disposition'], /^inline;/);
  assert.equal(result.body, '0123456789');
});

test('authenticated media supports suffix ranges and rejects invalid ranges', async () => {
  const suffix = await download('bytes=-3');
  assert.equal(suffix.status, 206);
  assert.equal(suffix.headers['content-range'], 'bytes 7-9/10');
  assert.equal(suffix.body, '789');
  const invalid = await download('bytes=20-30');
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers['content-range'], 'bytes */10');
});

test('document media uses attachment disposition and HEAD returns headers without a body', async () => {
  const document = await download(null, { mediaType: 'document', mimeType: 'application/pdf', method: 'HEAD' });
  assert.equal(document.status, 200);
  assert.equal(document.headers['content-type'], 'application/pdf');
  assert.equal(document.headers['content-length'], '10');
  assert.match(document.headers['content-disposition'], /^attachment;/);
  assert.equal(document.body, '');
});

test('authenticated audio/video media download supports byte ranges', async () => {
  const result = await download('bytes=2-5');
  assert.equal(result.status, 206);
  assert.equal(result.headers['content-range'], 'bytes 2-5/10');
  assert.equal(result.headers['content-length'], '4');
  assert.equal(result.body, '2345');
});
