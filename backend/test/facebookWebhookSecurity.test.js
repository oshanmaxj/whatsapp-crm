const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const controller = require('../src/controllers/facebookWebhook.controller');
const models = require('../src/models');
const facebookMessengerService = require('../src/services/facebookMessenger.service');
const facebookCommentService = require('../src/services/facebookComment.service');
const facebookSettingsService = require('../src/services/facebookSettings.service');

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  return res;
}

function sign(secret, body) {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function withMocks({ page, webhookEventCreateImpl, messengerImpl, commentImpl, config = {} }, callback) {
  const originals = {
    findOne: models.FacebookPage.findOne,
    weCreate: models.FacebookWebhookEvent.create,
    weUpdate: models.FacebookWebhookEvent.update,
    fcUpdate: models.FacebookComment.update,
    handleInbound: facebookMessengerService.handleInboundMessagingEvent,
    ingestComment: facebookCommentService.ingestComment,
    getRuntimeConfig: facebookSettingsService.getRuntimeConfig
  };
  models.FacebookPage.findOne = async ({ where }) => (page && where.pageId === page.pageId ? page : null);
  models.FacebookWebhookEvent.create = webhookEventCreateImpl || (async () => ({}));
  models.FacebookWebhookEvent.update = async () => [1];
  models.FacebookComment.update = async () => [1];
  facebookMessengerService.handleInboundMessagingEvent = messengerImpl || (async () => null);
  facebookCommentService.ingestComment = commentImpl || (async () => ({ comment: {}, created: true }));
  facebookSettingsService.getRuntimeConfig = async () => ({ appId: '', appSecret: '', webhookVerifyToken: '', graphApiVersion: 'v21.0', ...config });
  try {
    return await callback();
  } finally {
    models.FacebookPage.findOne = originals.findOne;
    models.FacebookWebhookEvent.create = originals.weCreate;
    models.FacebookWebhookEvent.update = originals.weUpdate;
    models.FacebookComment.update = originals.fcUpdate;
    facebookMessengerService.handleInboundMessagingEvent = originals.handleInbound;
    facebookCommentService.ingestComment = originals.ingestComment;
    facebookSettingsService.getRuntimeConfig = originals.getRuntimeConfig;
  }
}

async function withVerifyConfig(config, callback) {
  const original = facebookSettingsService.getRuntimeConfig;
  facebookSettingsService.getRuntimeConfig = async () => ({ appId: '', appSecret: '', webhookVerifyToken: '', graphApiVersion: 'v21.0', ...config });
  try {
    return await callback();
  } finally {
    facebookSettingsService.getRuntimeConfig = original;
  }
}

test('GET verification rejects when no verify token is configured (neither settings nor env)', async () => {
  await withVerifyConfig({ webhookVerifyToken: '' }, async () => {
    const res = fakeRes();
    await controller.verifyWebhook({ query: {} }, res);
    assert.equal(res.statusCode, 503);
  });
});

test('GET verification echoes the challenge for a matching token resolved from the centralized config', async () => {
  await withVerifyConfig({ webhookVerifyToken: 'secret-verify-token' }, async () => {
    const res = fakeRes();
    await controller.verifyWebhook({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'secret-verify-token', 'hub.challenge': 'CHALLENGE123' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'CHALLENGE123');
  });
});

test('GET verification rejects a mismatched token', async () => {
  await withVerifyConfig({ webhookVerifyToken: 'secret-verify-token' }, async () => {
    const res = fakeRes();
    await controller.verifyWebhook({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'X' } }, res);
    assert.equal(res.statusCode, 403);
  });
});

test('GET verification never logs the received or stored token', async () => {
  const logger = require('../src/config/logger');
  const originalWarn = logger.warn;
  const originalInfo = logger.info;
  const seen = [];
  logger.warn = (...args) => seen.push(args);
  logger.info = (...args) => seen.push(args);
  try {
    await withVerifyConfig({ webhookVerifyToken: 'secret-verify-token' }, async () => {
      await controller.verifyWebhook({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-guess', 'hub.challenge': 'X' } }, fakeRes());
    });
  } finally {
    logger.warn = originalWarn;
    logger.info = originalInfo;
  }
  const serialized = JSON.stringify(seen);
  assert.equal(serialized.includes('secret-verify-token'), false);
  assert.equal(serialized.includes('wrong-guess'), false);
});

test('POST rejects an invalid X-Hub-Signature-256 and never touches inbound processing', async () => {
  const page = { id: 1, pageId: 'PAGE_SIG_TEST', active: true };
  let called = false;
  await withMocks({ page, config: { appSecret: 'app-secret-value' }, messengerImpl: async () => { called = true; } }, async () => {
    const body = { object: 'page', entry: [{ id: 'PAGE_SIG_TEST', messaging: [{ sender: { id: 'psid1' }, message: { mid: 'mid1', text: 'hi' } }] }] };
    const rawBody = Buffer.from(JSON.stringify(body));
    const req = { body, rawBody, headers: { 'x-hub-signature-256': 'sha256=deadbeef' } };
    const res = fakeRes();
    await controller.processWebhook(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(called, false, 'inbound processing must not run when the signature is invalid');
  });
});

test('POST accepts a valid X-Hub-Signature-256 (App Secret resolved from centralized config) and processes the message', async () => {
  const page = { id: 2, pageId: 'PAGE_SIG_OK', active: true };
  let called = false;
  await withMocks({ page, config: { appSecret: 'app-secret-value' }, messengerImpl: async () => { called = true; } }, async () => {
    const body = { object: 'page', entry: [{ id: 'PAGE_SIG_OK', messaging: [{ sender: { id: 'psid1' }, message: { mid: 'mid-ok', text: 'hi' } }] }] };
    const rawBody = Buffer.from(JSON.stringify(body));
    const req = { body, rawBody, headers: { 'x-hub-signature-256': sign('app-secret-value', rawBody) } };
    const res = fakeRes();
    await controller.processWebhook(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(called, true);
  });
});

test('POST always acknowledges 200 quickly even without a configured app secret (logs a warning instead of failing)', async () => {
  const page = { id: 3, pageId: 'PAGE_NO_SECRET', active: true };
  await withMocks({ page }, async () => {
    const body = { object: 'page', entry: [{ id: 'PAGE_NO_SECRET', messaging: [{ sender: { id: 'psid1' }, message: { mid: 'mid-2', text: 'hi' } }] }] };
    const req = { body, rawBody: Buffer.from(JSON.stringify(body)), headers: {} };
    const res = fakeRes();
    await controller.processWebhook(req, res);
    assert.equal(res.statusCode, 200);
  });
});

test('duplicate webhook delivery (same messaging mid) is processed only once', async () => {
  const page = { id: 4, pageId: 'PAGE_DEDUP', active: true };
  const claimedKeys = new Set();
  let processedCount = 0;
  const webhookEventCreateImpl = async ({ eventKey }) => {
    if (claimedKeys.has(eventKey)) {
      const error = new Error('duplicate'); error.name = 'SequelizeUniqueConstraintError'; throw error;
    }
    claimedKeys.add(eventKey);
    return { eventKey };
  };
  await withMocks({ page, webhookEventCreateImpl, messengerImpl: async () => { processedCount += 1; } }, async () => {
    const body = { object: 'page', entry: [{ id: 'PAGE_DEDUP', messaging: [{ sender: { id: 'psid1' }, message: { mid: 'mid-dup', text: 'hi' } }] }] };
    const req = () => ({ body, rawBody: Buffer.from(JSON.stringify(body)), headers: {} });
    await controller.processWebhook(req(), fakeRes());
    await controller.processWebhook(req(), fakeRes()); // Meta-style retry redelivery of the exact same payload
    assert.equal(processedCount, 1, 'a retried delivery of the same mid must not be processed twice');
  });
});

test('a malformed nested messaging item does not prevent sibling items in the same batch from being processed', async () => {
  const page = { id: 5, pageId: 'PAGE_ISOLATION', active: true };
  const processed = [];
  const messengerImpl = async (_page, item) => {
    if (item.message.mid === 'mid-bad') throw new Error('boom - malformed item');
    processed.push(item.message.mid);
  };
  await withMocks({ page, messengerImpl }, async () => {
    const body = {
      object: 'page',
      entry: [{
        id: 'PAGE_ISOLATION',
        messaging: [
          { sender: { id: 'psid1' }, message: { mid: 'mid-bad', text: 'boom' } },
          { sender: { id: 'psid2' }, message: { mid: 'mid-good', text: 'fine' } }
        ]
      }]
    };
    const req = { body, rawBody: Buffer.from(JSON.stringify(body)), headers: {} };
    const res = fakeRes();
    await controller.processWebhook(req, res);
    assert.equal(res.statusCode, 200, 'the whole batch must still be acknowledged');
    assert.deepEqual(processed, ['mid-good'], 'the sibling item must still be processed despite the malformed one');
  });
});

test('an unknown Page ID is skipped safely without crashing the request', async () => {
  const res = fakeRes();
  await withMocks({ page: null }, async () => {
    const body = { object: 'page', entry: [{ id: 'UNKNOWN_PAGE', messaging: [{ sender: { id: 'psid1' }, message: { mid: 'mid-x', text: 'hi' } }] }] };
    const req = { body, rawBody: Buffer.from(JSON.stringify(body)), headers: {} };
    await controller.processWebhook(req, res);
  });
  assert.equal(res.statusCode, 200);
});

test('a non-Page object is ignored without processing', async () => {
  const res = fakeRes();
  await withMocks({ page: null }, async () => {
    await controller.processWebhook({ body: { object: 'instagram', entry: [] }, rawBody: Buffer.from('{}'), headers: {} }, res);
  });
  assert.equal(res.statusCode, 200);
});

test('feed comment change is routed to comment ingestion, deduplicated by comment id + verb', async () => {
  const page = { id: 6, pageId: 'PAGE_COMMENT', active: true };
  const claimedKeys = new Set();
  let ingestCount = 0;
  const webhookEventCreateImpl = async ({ eventKey }) => {
    if (claimedKeys.has(eventKey)) { const error = new Error('dup'); error.name = 'SequelizeUniqueConstraintError'; throw error; }
    claimedKeys.add(eventKey);
    return {};
  };
  await withMocks({ page, webhookEventCreateImpl, commentImpl: async () => { ingestCount += 1; return { comment: {}, created: true }; } }, async () => {
    const body = {
      object: 'page',
      entry: [{ id: 'PAGE_COMMENT', changes: [{ field: 'feed', value: { item: 'comment', comment_id: 'c1', post_id: 'p1', verb: 'add', from: { id: 'psid1', name: 'Jane' }, message: 'hello' } }] }]
    };
    const req = () => ({ body, rawBody: Buffer.from(JSON.stringify(body)), headers: {} });
    await controller.processWebhook(req(), fakeRes());
    await controller.processWebhook(req(), fakeRes());
    assert.equal(ingestCount, 1, 'duplicate comment webhook delivery must not ingest twice');
  });
});
