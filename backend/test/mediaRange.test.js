const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const mediaController = require('../src/controllers/media.controller');
const inboxService = require('../src/services/inbox.service');

async function download(range) {
  const filePath = path.join(os.tmpdir(), `crm-media-range-${process.pid}-${Date.now()}.mp4`);
  await fsp.writeFile(filePath, Buffer.from('0123456789'));
  const original = inboxService.getMedia;
  inboxService.getMedia = async () => ({
    storagePath: filePath, originalName: 'clip.mp4', mimeType: 'video/mp4', mediaType: 'video'
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
      { params: { id: '1' }, user: { id: 1 }, headers: range ? { range } : {} },
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
  assert.equal(result.body, '0123456789');
});

test('authenticated audio/video media download supports byte ranges', async () => {
  const result = await download('bytes=2-5');
  assert.equal(result.status, 206);
  assert.equal(result.headers['content-range'], 'bytes 2-5/10');
  assert.equal(result.headers['content-length'], '4');
  assert.equal(result.body, '2345');
});
