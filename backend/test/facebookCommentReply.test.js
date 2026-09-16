const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

const facebookCommentService = require('../src/services/facebookComment.service');
const facebookPageService = require('../src/services/facebookPage.service');
const facebookPageAccessService = require('../src/services/facebookPageAccess.service');
const facebookConversationIdentityService = require('../src/services/facebookConversationIdentity.service');
const facebookSettingsService = require('../src/services/facebookSettings.service');
const leadService = require('../src/services/lead.service');
const models = require('../src/models');

function fakeComment(overrides = {}) {
  const comment = {
    id: 1, facebookPageId: 7, metaCommentId: 'c1', metaPostId: 'p1', replied: false, assignedUserId: null,
    update: async function (fields) { Object.assign(this, fields); return this; },
    ...overrides
  };
  return comment;
}

async function withReplyMocks({ comment, config, postImpl }, callback) {
  const originals = {
    findByPk: models.FacebookComment.findByPk,
    runtimeConfig: facebookPageService.runtimeConfig,
    getRuntimeConfig: facebookSettingsService.getRuntimeConfig,
    axiosPost: axios.post
  };
  models.FacebookComment.findByPk = async () => comment;
  facebookPageService.runtimeConfig = async () => config;
  facebookSettingsService.getRuntimeConfig = async () => ({ appId: '', appSecret: '', webhookVerifyToken: '', graphApiVersion: 'v21.0' });
  axios.post = postImpl;
  try {
    return await callback();
  } finally {
    models.FacebookComment.findByPk = originals.findByPk;
    facebookPageService.runtimeConfig = originals.runtimeConfig;
    facebookSettingsService.getRuntimeConfig = originals.getRuntimeConfig;
    axios.post = originals.axiosPost;
  }
}

test('replying posts to the comment\'s own Graph API edge using that Page\'s token and marks it replied', async () => {
  const comment = fakeComment();
  const config = { facebookPageId: 7, pageId: 'PAGE_777', pageAccessToken: 'page-token-777' };
  let seenUrl; let seenParams;
  await withReplyMocks({ comment, config, postImpl: async (url, data, options) => { seenUrl = url; seenParams = options.params; return { data: { id: 'reply-1' } }; } }, async () => {
    const result = await facebookCommentService.replyToComment(1, { message: 'Thanks!' }, null);
    assert.equal(result.replied, true);
    assert.equal(seenUrl.includes('/c1/comments'), true);
    assert.equal(seenParams.access_token, 'page-token-777');
    assert.equal(seenParams.message, 'Thanks!');
  });
});

test('replying twice to an already-replied comment does not call the Graph API again (idempotent retry)', async () => {
  const comment = fakeComment({ replied: true });
  let calls = 0;
  await withReplyMocks({ comment, config: {}, postImpl: async () => { calls += 1; return { data: {} }; } }, async () => {
    const result = await facebookCommentService.replyToComment(1, { message: 'Thanks again' }, null);
    assert.equal(calls, 0, 'a comment already marked replied must not trigger a second Graph API call');
    assert.equal(result.replied, true);
  });
});

test('a failed reply leaves the comment un-replied and never leaks the Page token in the error', async () => {
  const comment = fakeComment();
  const config = { facebookPageId: 7, pageId: 'PAGE_777', pageAccessToken: 'super-secret-token' };
  await withReplyMocks({
    comment, config,
    postImpl: async () => { const error = new Error('fail'); error.response = { data: { error: { message: 'Unsupported get request.' } } }; throw error; }
  }, async () => {
    await assert.rejects(
      facebookCommentService.replyToComment(1, { message: 'x' }, null),
      (error) => {
        assert.equal(error.code, 'FACEBOOK_COMMENT_REPLY_FAILED');
        assert.equal(String(error.message).includes('super-secret-token'), false);
        return true;
      }
    );
    assert.equal(comment.replied, false);
  });
});

test('reply requires non-empty message text', async () => {
  const comment = fakeComment();
  await withReplyMocks({ comment, config: {}, postImpl: async () => { throw new Error('must not be called'); } }, async () => {
    await assert.rejects(facebookCommentService.replyToComment(1, { message: '   ' }, null), (error) => error.status === 400);
  });
});

test('a user without access to the comment\'s Page is denied with 403 before any Graph API call', async () => {
  const comment = fakeComment({ facebookPageId: 42 });
  const originalUserFindByPk = models.User.findByPk;
  models.User.findByPk = async () => ({ id: 1, isSystemAdmin: false, allFacebookPages: false, roles: [], facebookPages: [{ id: 5 }] });
  let calls = 0;
  try {
    await withReplyMocks({ comment, config: {}, postImpl: async () => { calls += 1; return { data: {} }; } }, async () => {
      await assert.rejects(facebookCommentService.replyToComment(1, { message: 'hi' }, 1), (error) => error.status === 403);
    });
  } finally {
    models.User.findByPk = originalUserFindByPk;
  }
  assert.equal(calls, 0);
});

test('ingesting the same Meta comment id twice does not create a duplicate row', async () => {
  const store = [];
  const originals = {
    findOne: models.FacebookComment.findOne,
    create: models.FacebookComment.create,
    resolveContactOnly: facebookConversationIdentityService.resolveContactOnly,
    getOpenLead: leadService.getOpenLeadForContactAndFacebookPage,
    createLead: leadService.createLead
  };
  models.FacebookComment.findOne = async ({ where }) => store.find((row) => row.metaCommentId === where.metaCommentId) || null;
  models.FacebookComment.create = async (payload) => { const row = { id: store.length + 1, ...payload }; store.push(row); return row; };
  facebookConversationIdentityService.resolveContactOnly = async () => ({ contact: { id: 9 } });
  leadService.getOpenLeadForContactAndFacebookPage = async () => ({ id: 20 });
  leadService.createLead = async () => ({ id: 20 });
  try {
    const payload = { facebookPageId: 7, metaCommentId: 'dup-c1', metaPostId: 'p1', psid: 'psid1', displayName: 'Jane', message: 'hello' };
    const first = await facebookCommentService.ingestComment(payload);
    const second = await facebookCommentService.ingestComment(payload);
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(store.length, 1, 'exactly one comment row must exist after two identical ingests');
  } finally {
    models.FacebookComment.findOne = originals.findOne;
    models.FacebookComment.create = originals.create;
    facebookConversationIdentityService.resolveContactOnly = originals.resolveContactOnly;
    leadService.getOpenLeadForContactAndFacebookPage = originals.getOpenLead;
    leadService.createLead = originals.createLead;
  }
});
