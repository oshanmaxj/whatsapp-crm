const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { flowMediaUpload, diagnostics, FLOW_MEDIA_TRANSPORT_LIMIT_BYTES } = require('../src/middleware/flowMediaUpload.middleware');
const errorMiddleware = require('../src/middleware/error.middleware');
const { validateMedia } = require('../src/services/interactiveMedia.service');

async function parseMultipart(blob, filename, fields = {}) {
  const server = http.createServer((req, res) => {
    req.params = { id: '22' };
    flowMediaUpload(req, res, (error) => {
      res.statusCode = error?.status || 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(error
        ? { error: error.code, message: error.message, rejectedLayer: error.rejectedLayer }
        : { fileName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, fields: req.body }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const form = new FormData();
    form.append('file', blob, filename);
    Object.entries(fields).forEach(([key, value]) => form.append(key, value));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/flows/22/media`, { method: 'POST', body: form });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('valid image multipart upload reaches the application unchanged', async () => {
  const result = await parseMultipart(new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }), 'header.jpg', { mediaType: 'image', whatsappAccountId: '7' });
  assert.equal(result.status, 200);
  assert.equal(result.body.mimeType, 'image/jpeg');
  assert.equal(result.body.fields.whatsappAccountId, '7');
});

test('valid MP4 below 16 MB passes transport and WhatsApp size validation', async () => {
  const result = await parseMultipart(new Blob([Buffer.from('small-mp4')], { type: 'video/mp4' }), 'header.mp4', { mediaType: 'video' });
  assert.equal(result.status, 200);
  assert.equal(result.body.mimeType, 'video/mp4');
  assert.doesNotThrow(() => validateMedia({ mediaType: 'video', mimeType: 'video/mp4', size: 15 * 1024 * 1024, fileName: 'header.mp4' }));
});

test('oversized MP4 is rejected at the 16 MB WhatsApp application limit', () => {
  assert.throws(
    () => validateMedia({ mediaType: 'video', mimeType: 'video/mp4', size: (16 * 1024 * 1024) + 1, fileName: 'header.mp4' }),
    (error) => error.status === 413 && error.code === 'FILE_TOO_LARGE' && /16 MB/.test(error.message)
  );
});

test('unsupported MIME type is rejected with a stable code', () => {
  assert.throws(
    () => validateMedia({ mediaType: 'image', mimeType: 'image/gif', size: 100, fileName: 'header.gif' }),
    (error) => error.code === 'INTERACTIVE_MEDIA_MIME_UNSUPPORTED'
  );
});

test('Multer transport limit is explicitly at least 20 MB', () => {
  assert.equal(FLOW_MEDIA_TRANSPORT_LIMIT_BYTES, 20 * 1024 * 1024);
});

test('413 errors are returned as structured JSON', () => {
  let status; let body;
  const req = { headers: {}, method: 'POST', originalUrl: '/api/flows/22/media', user: { id: 1 } };
  const res = { status(value) { status = value; return this; }, json(value) { body = value; return this; } };
  errorMiddleware(Object.assign(new Error('Video exceeds the 16 MB WhatsApp limit.'), {
    status: 413, code: 'FILE_TOO_LARGE', rejectedLayer: 'multer', uploadError: true, exposeMessage: true
  }), req, res, () => {});
  assert.equal(status, 413);
  assert.equal(body.error, 'FILE_TOO_LARGE');
  assert.equal(body.message, 'Video exceeds the 16 MB WhatsApp limit.');
  assert.equal(body.rejectedLayer, 'multer');
});

test('upload diagnostics expose limits without file data or credentials', () => {
  let body;
  diagnostics({}, { json(value) { body = value; return this; } });
  assert.equal(body.data.transport, 'multipart/form-data');
  assert.equal(body.data.backendTransportLimitBytes, 20 * 1024 * 1024);
  assert.doesNotMatch(JSON.stringify(body), /token|secret|fileContent/i);
});
