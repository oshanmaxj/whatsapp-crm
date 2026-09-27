const test = require('node:test');
const assert = require('node:assert/strict');

const facebookMessengerService = require('../src/services/facebookMessenger.service');
const { isPermanentMessengerSendError } = facebookMessengerService;
const facebookPageService = require('../src/services/facebookPage.service');
const models = require('../src/models');

function fakeConversation(overrides = {}) {
  return {
    id: 100, facebookPageId: 7, contactId: 55, channel: 'facebook_messenger',
    lastMessage: null, lastMessageAt: null,
    update: async function (fields) { Object.assign(this, fields); return this; },
    ...overrides
  };
}

// lastInboundAt: null means "no inbound message has ever been recorded for
// this conversation" (e.g. a Facebook Comments contact who has never
// actually messaged the Page) — the messaging window is closed either way.
async function withMocks({ conversation, config, contactPsid = 'psid-target', postImpl, lastInboundAt = new Date() }, callback) {
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
  models.Message.findOne = async ({ where }) => {
    if (where.facebookMessageId) return null;
    if (where.direction === 'inbound') return lastInboundAt ? { createdAt: lastInboundAt } : null;
    return null;
  };
  models.Message.create = async (payload) => ({ id: 900, ...payload });
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

const openConfig = { facebookPageId: 7, pageId: 'PAGE_777', pageAccessToken: 'token', sendEnabled: true };

test('sendQuickReplies posts the correct Messenger quick_replies payload shape', async () => {
  let seenPayload;
  await withMocks({
    conversation: fakeConversation(), config: openConfig,
    postImpl: async (url, payload) => { seenPayload = payload; return { data: { message_id: 'mid-qr' } }; }
  }, async () => {
    const record = await facebookMessengerService.sendQuickReplies({
      conversationId: 100, text: 'Choose one',
      quickReplies: [{ id: 'flowbtn:1:n1:a', title: 'A' }, { id: 'flowbtn:1:n1:b', title: 'B' }]
    });
    assert.equal(record.facebookMessageId, 'mid-qr');
    assert.equal(seenPayload.message.text, 'Choose one');
    assert.equal(seenPayload.message.quick_replies.length, 2);
    assert.equal(seenPayload.message.quick_replies[0].content_type, 'text');
    assert.equal(seenPayload.message.quick_replies[0].payload, 'flowbtn:1:n1:a');
  });
});

test('sendQuickReplies rejects more than 13 options instead of silently truncating', async () => {
  await withMocks({ conversation: fakeConversation(), config: openConfig, postImpl: async () => { throw new Error('must not be called'); } }, async () => {
    const quickReplies = Array.from({ length: 14 }, (_, i) => ({ id: `flowbtn:1:n1:o${i}`, title: `O${i}` }));
    await assert.rejects(
      facebookMessengerService.sendQuickReplies({ conversationId: 100, text: 'Choose', quickReplies }),
      (error) => error.code === 'FACEBOOK_QUICK_REPLY_LIMIT_EXCEEDED'
    );
  });
});

test('sendGenericTemplate posts the correct generic template payload shape with title/subtitle/postback button', async () => {
  let seenPayload;
  await withMocks({
    conversation: fakeConversation(), config: openConfig,
    postImpl: async (url, payload) => { seenPayload = payload; return { data: { message_id: 'mid-carousel' } }; }
  }, async () => {
    await facebookMessengerService.sendGenericTemplate({
      conversationId: 100,
      elements: [{ id: 'flowbtn:1:n1:a', title: 'Course A', description: 'A great course' }]
    });
    const element = seenPayload.message.attachment.payload.elements[0];
    assert.equal(seenPayload.message.attachment.payload.template_type, 'generic');
    assert.equal(element.title, 'Course A');
    assert.equal(element.subtitle, 'A great course');
    assert.equal(element.buttons[0].type, 'postback');
    assert.equal(element.buttons[0].payload, 'flowbtn:1:n1:a');
  });
});

test('sendQuickReplies is blocked when the 24-hour messaging window is closed', async () => {
  let posted = false;
  await withMocks({
    conversation: fakeConversation(), config: openConfig, lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    postImpl: async () => { posted = true; return { data: { message_id: 'should-not-happen' } }; }
  }, async () => {
    await assert.rejects(
      facebookMessengerService.sendQuickReplies({ conversationId: 100, text: 'Choose', quickReplies: [{ id: 'a', title: 'A' }] }),
      (error) => error.code === 'FACEBOOK_MESSAGING_WINDOW_CLOSED'
    );
  });
  assert.equal(posted, false, 'the Graph API must never be called once the window is known to be closed');
});

test('sendGenericTemplate is blocked for a contact with no prior inbound message at all (e.g. comment-only contact) — never an unsolicited private message', async () => {
  let posted = false;
  await withMocks({
    conversation: fakeConversation(), config: openConfig, lastInboundAt: null,
    postImpl: async () => { posted = true; return { data: { message_id: 'should-not-happen' } }; }
  }, async () => {
    await assert.rejects(
      facebookMessengerService.sendGenericTemplate({ conversationId: 100, elements: [{ id: 'a', title: 'A' }] }),
      (error) => error.code === 'FACEBOOK_MESSAGING_WINDOW_CLOSED'
    );
  });
  assert.equal(posted, false);
});

test('sendQuickReplies succeeds when the last inbound message is within the 24-hour window', async () => {
  await withMocks({
    conversation: fakeConversation(), config: openConfig, lastInboundAt: new Date(Date.now() - 60 * 60 * 1000),
    postImpl: async () => ({ data: { message_id: 'mid-ok' } })
  }, async () => {
    const record = await facebookMessengerService.sendQuickReplies({ conversationId: 100, text: 'Choose', quickReplies: [{ id: 'a', title: 'A' }] });
    assert.equal(record.facebookMessageId, 'mid-ok');
  });
});

test('sendButtonMessage (the pre-existing button_message adapter) is also protected by the same window check', async () => {
  let posted = false;
  await withMocks({
    conversation: fakeConversation(), config: openConfig, lastInboundAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
    postImpl: async () => { posted = true; return { data: {} }; }
  }, async () => {
    await assert.rejects(
      facebookMessengerService.sendButtonMessage({ conversationId: 100, text: 'Choose', buttons: [{ id: 'a', title: 'A' }] }),
      (error) => error.code === 'FACEBOOK_MESSAGING_WINDOW_CLOSED'
    );
  });
  assert.equal(posted, false);
});

test('isPermanentMessengerSendError classifies a window-closed error and Meta error code 10 as permanent, but a transient 500 as not permanent', () => {
  assert.equal(isPermanentMessengerSendError(Object.assign(new Error('x'), { code: 'FACEBOOK_MESSAGING_WINDOW_CLOSED' })), true);
  assert.equal(isPermanentMessengerSendError({ response: { data: { error: { code: 10 } } } }), true);
  assert.equal(isPermanentMessengerSendError({ response: { status: 500, data: { error: { code: 1 } } } }), false);
  assert.equal(isPermanentMessengerSendError({}), false);
});
