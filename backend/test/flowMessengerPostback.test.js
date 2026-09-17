const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const flowService = require('../src/services/flow.service');
const facebookMessengerService = require('../src/services/facebookMessenger.service');
const facebookConversationIdentityService = require('../src/services/facebookConversationIdentity.service');

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

// 7 & 11 (receive side): a Messenger postback resumes a waiting FlowRun and
// executes the same button-action mechanism WhatsApp interactive replies use
// — no parallel Facebook-only continuation implementation.
test('scenario 7/11: a Messenger postback resumes the waiting run for its button and executes the matching action', async () => {
  const flow = {
    id: 5, status: 'published', channel: 'facebook_messenger', channels: null,
    whatsappAccountId: null, facebookPageId: 9,
    nodes: [{
      id: 1, nodeKey: 'n1', nodeType: 'button_message', label: 'Choose', stats: {},
      configJson: { buttons: [{ id: 'yes', title: 'Yes', primaryActionType: 'ADD_LABELS', primaryActionConfig: { labelIds: [7] } }] }
    }],
    connections: []
  };
  const waitingRun = {
    id: 700, flowId: 5, contactId: 501, status: 'waiting', waitingForReply: true, waitingNodeKey: 'n1',
    contextJson: { flowId: 5, channel: 'facebook_messenger', facebookPageId: 9 },
    async update(patch) { Object.assign(this, patch); return this; }
  };

  const restore = patchModelMethods({
    'FlowRun.findOne': async ({ where }) => {
      if (where.status === 'waiting') return waitingRun;
      return null; // no duplicate found for the postback's synthetic eventKey
    },
    'FlowRun.findByPk': async (id) => (Number(id) === waitingRun.id ? waitingRun : null),
    'Flow.findOne': async ({ where }) => (Number(where.id) === flow.id ? flow : null),
    'FlowNode.update': async () => [1],
    'FlowRunLog.create': async () => ({}),
    'ConversationLabel.findOrCreate': async () => [{}, true]
  });

  const originalResolve = facebookConversationIdentityService.findOrCreateByPageAndPsid;
  facebookConversationIdentityService.findOrCreateByPageAndPsid = async () => ({
    contact: { id: 501, toJSON: () => ({ id: 501 }) },
    conversation: { id: 777, toJSON: () => ({ id: 777 }) },
    facebookContact: {}, created: false
  });

  try {
    const page = { id: 9, pageId: '106024052262867' };
    const item = { sender: { id: 'psid-postback-1' }, postback: { payload: 'flowbtn:5:n1:yes' }, timestamp: String(Date.now()) };
    const result = await facebookMessengerService.handleInboundPostbackEvent(page, item);

    assert.ok(result?.run, 'expected the postback to resolve to a flow run');
    assert.equal(waitingRun.status, 'completed', 'the waiting run must have progressed past the waiting node');
  } finally {
    facebookConversationIdentityService.findOrCreateByPageAndPsid = originalResolve;
    restore();
  }
});

test('a Messenger postback with no matching waiting run and no matching new-trigger flow is a safe no-op', async () => {
  const restore = patchModelMethods({
    'FlowRun.findOne': async () => null,
    'Flow.findAll': async () => [],
    'Message.count': async () => 1
  });
  const originalResolve = facebookConversationIdentityService.findOrCreateByPageAndPsid;
  facebookConversationIdentityService.findOrCreateByPageAndPsid = async () => ({
    contact: { id: 999, toJSON: () => ({ id: 999 }) },
    conversation: { id: 888, toJSON: () => ({ id: 888 }) },
    facebookContact: {}, created: true
  });
  try {
    const page = { id: 9, pageId: '106024052262867' };
    const item = { sender: { id: 'psid-orphan' }, postback: { payload: 'flowbtn:999:missing:whatever' }, timestamp: String(Date.now()) };
    const result = await facebookMessengerService.handleInboundPostbackEvent(page, item);
    assert.equal(result.run, null);
  } finally {
    facebookConversationIdentityService.findOrCreateByPageAndPsid = originalResolve;
    restore();
  }
});

test('a postback item with no payload or sender is ignored without throwing', async () => {
  const page = { id: 9, pageId: '106024052262867' };
  assert.equal(await facebookMessengerService.handleInboundPostbackEvent(page, { postback: {} }), null);
  assert.equal(await facebookMessengerService.handleInboundPostbackEvent(page, { sender: { id: 'x' } }), null);
});
