const test = require('node:test');
const assert = require('node:assert/strict');

const facebookMessengerService = require('../src/services/facebookMessenger.service');
const facebookPageService = require('../src/services/facebookPage.service');
const models = require('../src/models');

function fakeConversation(overrides = {}) {
  const conversation = {
    id: 100, facebookPageId: 7, contactId: 55, channel: 'facebook_messenger',
    lastMessage: null, lastMessageAt: null,
    update: async function (fields) { Object.assign(this, fields); return this; },
    ...overrides
  };
  return conversation;
}

async function withMocks({ conversation, config, contactPsid = 'psid-target', postImpl, createdMessages = [] }, callback) {
  const originals = {
    convFindByPk: models.Conversation.findByPk,
    fcFindOne: models.FacebookContact.findOne,
    msgFindOne: models.Message.findOne,
    msgCreate: models.Message.create,
    runtimeConfig: facebookPageService.runtimeConfig,
    requestClient: facebookMessengerService.requestClient
  };
  models.Conversation.findByPk = async () => conversation;
  models.FacebookContact.findOne = async () => (contactPsid ? { facebookPsid: contactPsid } : null);
  models.Message.findOne = async ({ where }) => (where.facebookMessageId ? createdMessages.find((m) => m.facebookMessageId === where.facebookMessageId) || null : null);
  models.Message.create = async (payload) => {
    const record = { id: createdMessages.length + 1, ...payload };
    createdMessages.push(record);
    return record;
  };
  facebookPageService.runtimeConfig = async () => config;
  facebookMessengerService.requestClient = async () => ({ client: { post: postImpl } });
  try {
    return await callback();
  } finally {
    models.Conversation.findByPk = originals.convFindByPk;
    models.FacebookContact.findOne = originals.fcFindOne;
    models.Message.findOne = originals.msgFindOne;
    models.Message.create = originals.msgCreate;
    facebookPageService.runtimeConfig = originals.runtimeConfig;
    facebookMessengerService.requestClient = originals.requestClient;
  }
}

test('sendTextMessage posts to the correct Page endpoint using that conversation\'s own Page token', async () => {
  const conversation = fakeConversation();
  const config = { facebookPageId: 7, pageId: 'PAGE_777', pageAccessToken: 'page-777-token', sendEnabled: true };
  let seenUrl; let seenParams; let seenPayload;
  await withMocks({
    conversation, config,
    postImpl: async (url, payload, options) => { seenUrl = url; seenPayload = payload; seenParams = options.params; return { data: { message_id: 'mid-out-1' } }; }
  }, async () => {
    const record = await facebookMessengerService.sendTextMessage({ conversationId: 100, text: 'Hello there' });
    assert.equal(record.facebookMessageId, 'mid-out-1');
    assert.equal(seenUrl, '/PAGE_777/messages');
    assert.equal(seenParams.access_token, 'page-777-token');
    assert.equal(seenPayload.recipient.id, 'psid-target');
    assert.equal(seenPayload.message.text, 'Hello there');
  });
});

test('sendTextMessage refuses to send when the Page has sending disabled', async () => {
  const conversation = fakeConversation();
  const config = { facebookPageId: 7, pageId: 'PAGE_777', pageAccessToken: 'x', sendEnabled: false };
  await withMocks({ conversation, config, postImpl: async () => { throw new Error('must not be called'); } }, async () => {
    await assert.rejects(
      facebookMessengerService.sendTextMessage({ conversationId: 100, text: 'hi' }),
      (error) => error.code === 'FACEBOOK_SEND_DISABLED'
    );
  });
});

test('sendTextMessage rejects a non-Facebook conversation', async () => {
  const conversation = fakeConversation({ facebookPageId: null });
  await withMocks({ conversation, config: {}, postImpl: async () => { throw new Error('must not be called'); } }, async () => {
    await assert.rejects(
      facebookMessengerService.sendTextMessage({ conversationId: 100, text: 'hi' }),
      (error) => error.code === 'FACEBOOK_CONVERSATION_REQUIRED'
    );
  });
});

test('a repeated clientMessageId (double-click / retry) short-circuits before calling the Graph API again', async () => {
  const conversation = fakeConversation();
  const config = { facebookPageId: 7, pageId: 'PAGE_777', pageAccessToken: 'x', sendEnabled: true };
  const existing = { id: 42, facebookMessageId: 'mid-existing', conversationId: 100, rawPayload: { clientMessageId: 'client-abc' } };
  let postCalls = 0;
  const originalFind = facebookMessengerService.findByClientMessageId;
  facebookMessengerService.findByClientMessageId = async (conversationId, clientMessageId) => (
    conversationId === 100 && clientMessageId === 'client-abc' ? existing : null
  );
  try {
    await withMocks({ conversation, config, postImpl: async () => { postCalls += 1; return { data: { message_id: 'should-not-happen' } }; } }, async () => {
      const record = await facebookMessengerService.sendTextMessage({ conversationId: 100, text: 'Hello', clientMessageId: 'client-abc' });
      assert.equal(record, existing);
      assert.equal(postCalls, 0, 'the Graph API must not be called again for a known clientMessageId');
    });
  } finally {
    facebookMessengerService.findByClientMessageId = originalFind;
  }
});

test('a failed Graph API send raises a safe error without leaking the Page token', async () => {
  const conversation = fakeConversation();
  const config = { facebookPageId: 7, pageId: 'PAGE_777', pageAccessToken: 'super-secret-page-token', sendEnabled: true };
  await withMocks({
    conversation, config,
    postImpl: async () => { const error = new Error('graph failure'); error.response = { data: { error: { message: 'Invalid OAuth access token.' } } }; throw error; }
  }, async () => {
    await assert.rejects(
      facebookMessengerService.sendTextMessage({ conversationId: 100, text: 'hi' }),
      (error) => {
        assert.equal(error.code, 'FACEBOOK_SEND_FAILED');
        assert.equal(String(error.message).includes('super-secret-page-token'), false);
        return true;
      }
    );
  });
});
