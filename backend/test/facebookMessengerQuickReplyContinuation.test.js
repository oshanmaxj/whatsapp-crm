const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const flowService = require('../src/services/flow.service');
const facebookMessengerService = require('../src/services/facebookMessenger.service');
const facebookConversationIdentityService = require('../src/services/facebookConversationIdentity.service');
const inboundFacebookMessageService = require('../src/services/inboundFacebookMessage.service');

function patchModelMethods(overrides) {
  const originals = {};
  for (const key of Object.keys(overrides)) {
    const [modelName, methodName] = key.split('.');
    originals[key] = db[modelName][methodName];
    db[modelName][methodName] = overrides[key];
  }
  return function restore() {
    for (const key of Object.keys(overrides)) {
      const [modelName, methodName] = key.split('.');
      db[modelName][methodName] = originals[key];
    }
  };
}

// Mirrors the real facebookConversationIdentityService contract closely
// enough to exercise handleInboundMessagingEvent's full persistence +
// dispatch path (see facebookConversationIdentity.service.js:108-112) without
// touching a real database.
function mockIdentityResolution({ contact, conversation }) {
  return async (values) => ({
    contact, conversation, facebookContact: {}, created: false,
    persisted: typeof values.afterResolve === 'function'
      ? await values.afterResolve({ contact, conversation, facebookContact: {}, transaction: {} })
      : null
  });
}

const page = { id: 9, pageId: '106024052262867' };
const flow = {
  id: 5, status: 'published', channel: 'facebook_messenger', channels: null,
  whatsappAccountId: null, facebookPageId: 9,
  nodes: [{
    id: 1, nodeKey: 'n1', nodeType: 'list_message', label: 'Choose', stats: {},
    configJson: { message: 'Pick one', rows: [{ id: 'yes', title: 'Yes', primaryActionType: 'ADD_LABELS', primaryActionConfig: { labelIds: [7] } }] }
  }],
  connections: []
};

test('a tapped Quick Reply resumes the waiting run for its option and executes the matching action (same mechanism as a Messenger postback)', async () => {
  const waitingRun = {
    id: 701, flowId: 5, contactId: 501, status: 'waiting', waitingForReply: true, waitingNodeKey: 'n1',
    contextJson: { flowId: 5, channel: 'facebook_messenger', facebookPageId: 9 },
    async update(patch) { Object.assign(this, patch); return this; }
  };
  const contact = { id: 501, toJSON: () => ({ id: 501 }) };
  const conversation = { id: 777, leadId: 42, toJSON: () => ({ id: 777 }), update: async () => conversation };

  const restore = patchModelMethods({
    'FlowRun.findOne': async ({ where }) => (where.status === 'waiting' ? waitingRun : null),
    'FlowRun.findByPk': async (id) => (Number(id) === waitingRun.id ? waitingRun : null),
    'Flow.findOne': async ({ where }) => (Number(where.id) === flow.id ? flow : null),
    'FlowNode.update': async () => [1],
    'FlowRunLog.create': async () => ({}),
    'ConversationLabel.findOrCreate': async () => [{}, true],
    'Message.findOne': async () => null
  });
  const originalResolve = facebookConversationIdentityService.findOrCreateByPageAndPsid;
  const originalPersist = inboundFacebookMessageService.persist;
  facebookConversationIdentityService.findOrCreateByPageAndPsid = mockIdentityResolution({ contact, conversation });
  inboundFacebookMessageService.persist = async () => ({ messageRecord: { id: 9001 }, created: true });
  try {
    const item = {
      sender: { id: 'psid-qr-1' },
      message: { mid: 'mid-qr-1', text: 'Yes', quick_reply: { payload: 'flowbtn:5:n1:yes' } },
      timestamp: String(Date.now())
    };
    await facebookMessengerService.handleInboundMessagingEvent(page, item);
    // The dispatch is fire-and-forget (setImmediate); give it a tick to run.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(waitingRun.status, 'completed', 'the waiting run must have progressed past the waiting list_message node');
  } finally {
    facebookConversationIdentityService.findOrCreateByPageAndPsid = originalResolve;
    inboundFacebookMessageService.persist = originalPersist;
    restore();
  }
});

test('a duplicate webhook delivery for the same Quick Reply message does not advance the flow twice', async () => {
  const waitingRun = {
    id: 702, flowId: 5, contactId: 502, status: 'waiting', waitingForReply: true, waitingNodeKey: 'n1',
    contextJson: { flowId: 5, channel: 'facebook_messenger', facebookPageId: 9 },
    async update(patch) { Object.assign(this, patch); return this; }
  };
  const contact = { id: 502, toJSON: () => ({ id: 502 }) };
  const conversation = { id: 778, leadId: 42, toJSON: () => ({ id: 778 }), update: async () => conversation };

  const restore = patchModelMethods({
    'FlowRun.findOne': async ({ where }) => (where.status === 'waiting' ? waitingRun : null),
    'FlowRun.findByPk': async (id) => (Number(id) === waitingRun.id ? waitingRun : null),
    'Flow.findOne': async ({ where }) => (Number(where.id) === flow.id ? flow : null),
    'FlowNode.update': async () => [1],
    'FlowRunLog.create': async () => ({}),
    'ConversationLabel.findOrCreate': async () => [{}, true],
    'Message.findOne': async () => null
  });
  const originalResolve = facebookConversationIdentityService.findOrCreateByPageAndPsid;
  const originalPersist = inboundFacebookMessageService.persist;
  facebookConversationIdentityService.findOrCreateByPageAndPsid = mockIdentityResolution({ contact, conversation });
  // A genuine Meta webhook retry re-delivers the identical message.mid. The
  // primary dedup layer for a Quick Reply (a real `message` event, unlike a
  // postback) is the SAME facebookMessageId idempotency every inbound
  // Messenger message already gets (inboundFacebookMessage.service.js):
  // handleInboundMessagingEvent only dispatches to the flow engine at all
  // when `created` is true, so a retried delivery reaching `created:false`
  // must skip flow dispatch entirely — simulated here instead of
  // re-deriving persist()'s own internals.
  let persistCalls = 0;
  inboundFacebookMessageService.persist = async () => {
    persistCalls += 1;
    return persistCalls === 1 ? { messageRecord: { id: 9002 }, created: true } : { messageRecord: { id: 9002 }, created: false };
  };
  try {
    const item = {
      sender: { id: 'psid-qr-2' },
      message: { mid: 'mid-qr-dup', text: 'Yes', quick_reply: { payload: 'flowbtn:5:n1:yes' } },
      timestamp: String(Date.now())
    };
    await facebookMessengerService.handleInboundMessagingEvent(page, item);
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(waitingRun.status, 'completed');
    waitingRun.status = 'completed_once_marker'; // detect a second, unwanted advancement attempt

    // Retried webhook delivery for the exact same Messenger message.
    await facebookMessengerService.handleInboundMessagingEvent(page, item);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(persistCalls, 2, 'persist is called again (idempotent no-op) but must report created:false');
    assert.equal(waitingRun.status, 'completed_once_marker', 'the retried delivery must not advance the flow a second time');
  } finally {
    facebookConversationIdentityService.findOrCreateByPageAndPsid = originalResolve;
    inboundFacebookMessageService.persist = originalPersist;
    restore();
  }
});

test('a Quick Reply payload for a flow/node that no longer exists is a safe no-op, not an unrelated flow execution', async () => {
  const contact = { id: 503, toJSON: () => ({ id: 503 }) };
  const conversation = { id: 779, leadId: 42, toJSON: () => ({ id: 779 }), update: async () => conversation };
  const restore = patchModelMethods({
    'FlowRun.findOne': async () => null,
    'Flow.findOne': async () => null,
    'Flow.findAll': async () => [],
    'Message.count': async () => 1,
    'Message.findOne': async () => null
  });
  const originalResolve = facebookConversationIdentityService.findOrCreateByPageAndPsid;
  const originalPersist = inboundFacebookMessageService.persist;
  facebookConversationIdentityService.findOrCreateByPageAndPsid = mockIdentityResolution({ contact, conversation });
  inboundFacebookMessageService.persist = async () => ({ messageRecord: { id: 9003 }, created: true });
  try {
    const item = {
      sender: { id: 'psid-qr-3' },
      message: { mid: 'mid-qr-missing', text: 'Yes', quick_reply: { payload: 'flowbtn:999:missing:yes' } },
      timestamp: String(Date.now())
    };
    const result = await facebookMessengerService.handleInboundMessagingEvent(page, item);
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(result.messageRecord, 'the message is still persisted for the conversation transcript');
  } finally {
    facebookConversationIdentityService.findOrCreateByPageAndPsid = originalResolve;
    inboundFacebookMessageService.persist = originalPersist;
    restore();
  }
});
