const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const flowService = require('../src/services/flow.service');
const facebookMessengerService = require('../src/services/facebookMessenger.service');
const facebookConversationIdentityService = require('../src/services/facebookConversationIdentity.service');
const facebookPageService = require('../src/services/facebookPage.service');

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

// Mirrors the exact production flow from Issue 2: WhatsApp + Facebook
// Messenger both checked, a WhatsApp account AND a Facebook Page selected,
// a single Start -> Text node ("Hi {{LEAD_USER_FIRST_NAME}}, how can we help
// you?"), no configured keywords (a generic "any inbound message" trigger).
function productionShapedFlow({ id = 30, facebookPageId = 9, keywords = [] } = {}) {
  return {
    id, status: 'published', channel: 'whatsapp', channels: ['whatsapp', 'facebook_messenger'],
    whatsappAccountId: 3, facebookPageId, departmentId: null,
    triggerType: 'keyword', triggerKeywords: keywords,
    triggerConfig: { source: 'inbound_message', matchType: 'contains' },
    nodes: [
      { id: 1, nodeKey: 'start', nodeType: 'start', label: 'Start', stats: {}, configJson: {} },
      { id: 2, nodeKey: 'greet', nodeType: 'text_message', label: 'Greeting', stats: {}, configJson: { message: 'Hi {{LEAD_USER_FIRST_NAME}}, how can we help you?' } }
    ],
    connections: [{ sourceNodeKey: 'start', targetNodeKey: 'greet' }]
  };
}

function fakeRun(id, extra = {}) {
  const run = { id, ...extra, async update(patch) { Object.assign(run, patch); return run; } };
  return run;
}

function standardMocks({ flow, flowRunsCreated, contact, conversation }) {
  return {
    'FlowRun.findOne': async () => null, // no dedup hit, no waiting run for a first-time contact
    'FlowRun.create': async (data) => { const run = fakeRun(flowRunsCreated.length + 1, data); flowRunsCreated.push(run); return run; },
    'FlowRun.findByPk': async (id) => flowRunsCreated.find((run) => run.id === Number(id)) || null,
    'Flow.findAll': async () => [flow],
    'Flow.findOne': async ({ where }) => (Number(where.id) === flow.id ? flow : null),
    'FlowRunLog.create': async () => ({}),
    'FlowNode.update': async () => [1],
    'FacebookContact.findOne': async () => null, // resolveProfileDisplayName's pre-check: no existing record yet
    'Contact.findByPk': async () => contact,
    'Lead.findByPk': async () => null,
    'Conversation.findByPk': async () => conversation,
    'Message.findOne': async () => null,
    'Message.create': async (data) => ({ id: 1, ...data }),
    'Message.count': async () => 1
  };
}

function patchIdentityAndSend({ contact, conversation }) {
  const originalResolve = facebookConversationIdentityService.findOrCreateByPageAndPsid;
  facebookConversationIdentityService.findOrCreateByPageAndPsid = async (values) => {
    const persisted = values.afterResolve ? await values.afterResolve({ contact, conversation, facebookContact: {}, transaction: {} }) : null;
    return { contact, conversation, facebookContact: {}, created: true, persisted };
  };
  const originalRuntimeConfig = facebookPageService.runtimeConfig;
  facebookPageService.runtimeConfig = async () => ({ pageId: '106024052262867', pageAccessToken: 'redacted', sendEnabled: true, facebookPageId: 9 });
  const originalSendText = facebookMessengerService.sendTextMessage;
  const sendCalls = [];
  facebookMessengerService.sendTextMessage = async (args) => { sendCalls.push(args); return { id: 999, facebookMessageId: 'fbmid-out-1' }; };
  // resolveProfileDisplayName's Graph API call is irrelevant to this trigger
  // test (profile resolution has its own dedicated test file) — make it fail
  // fast instead of attempting a real network call in a sandbox.
  const originalRequestClient = facebookMessengerService.requestClient;
  facebookMessengerService.requestClient = async () => { throw new Error('network disabled in this test'); };
  return {
    sendCalls,
    restore() {
      facebookConversationIdentityService.findOrCreateByPageAndPsid = originalResolve;
      facebookPageService.runtimeConfig = originalRuntimeConfig;
      facebookMessengerService.sendTextMessage = originalSendText;
      facebookMessengerService.requestClient = originalRequestClient;
    }
  };
}

// 1, 2, 5, 9. Full production reproduction: a generic inbound Messenger text
// (no keyword requirement) starts the published multi-channel flow and the
// Facebook adapter sends the rendered greeting exactly once, even when the
// contact has no first name yet (LEAD_USER_FIRST_NAME must not crash).
test('reproduction: a published WhatsApp+Messenger flow with no configured keywords triggers on a generic Messenger message and sends via the Facebook adapter', async () => {
  const flow = productionShapedFlow();
  const flowRunsCreated = [];
  const contact = { id: 501, firstName: null, lastName: null, toJSON: () => ({ id: 501, firstName: null, lastName: null }) };
  const conversation = { id: 777, leadId: 1, facebookPageId: 9, toJSON: () => ({ id: 777 }), async update(patch) { Object.assign(this, patch); } };

  const restoreModels = patchModelMethods(standardMocks({ flow, flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });

  let capturedPromise = null;
  const originalHandleInboundMessage = flowService.handleInboundMessage;
  flowService.handleInboundMessage = (...args) => { capturedPromise = originalHandleInboundMessage.apply(flowService, args); return capturedPromise; };

  try {
    const page = { id: 9, pageId: '106024052262867' };
    const item = { sender: { id: 'psid-ordinary-1' }, message: { mid: 'mid-e2e-1', text: 'Hi there, need help with pricing' }, timestamp: String(Date.now()) };
    await facebookMessengerService.handleInboundMessagingEvent(page, item);

    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(capturedPromise, 'handleInboundMessage must have been invoked by the dispatch');
    await capturedPromise;
    // handleInboundMessage(matchNewTriggers:false) found no waiting run and
    // returned null synchronously, but handleDomainEvent below it is also
    // fire-and-forget — give its own microtask chain a turn to finish too.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(flowRunsCreated.length, 1, 'exactly one FlowRun must be created for this new trigger');
    assert.equal(identity.sendCalls.length, 1, 'the Facebook adapter must send the greeting exactly once');
    assert.equal(identity.sendCalls[0].conversationId, 777);
    assert.equal(identity.sendCalls[0].text, 'Hi , how can we help you?', 'LEAD_USER_FIRST_NAME must render as empty, not crash, when the contact has no first name yet');
  } finally {
    flowService.handleInboundMessage = originalHandleInboundMessage;
    identity.restore();
    restoreModels();
  }
});

// 3. The same trigger for a different Page must not fire.
test('the same generic trigger does not fire for a different Facebook Page', async () => {
  const flow = productionShapedFlow({ facebookPageId: 9 });
  const flowRunsCreated = [];
  const contact = { id: 502, firstName: 'Sam', lastName: null, toJSON: () => ({ id: 502, firstName: 'Sam' }) };
  const conversation = { id: 778, leadId: 1, facebookPageId: 12345, toJSON: () => ({ id: 778 }), async update() {} };
  const restoreModels = patchModelMethods(standardMocks({ flow, flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });
  let capturedPromise = null;
  const originalHandleInboundMessage = flowService.handleInboundMessage;
  flowService.handleInboundMessage = (...args) => { capturedPromise = originalHandleInboundMessage.apply(flowService, args); return capturedPromise; };
  try {
    const page = { id: 12345, pageId: 'some-other-page' }; // different internal facebookPageId than the flow
    const item = { sender: { id: 'psid-other-page-1' }, message: { mid: 'mid-e2e-2', text: 'hello' }, timestamp: String(Date.now()) };
    await facebookMessengerService.handleInboundMessagingEvent(page, item);
    await new Promise((resolve) => setImmediate(resolve));
    if (capturedPromise) await capturedPromise;
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(flowRunsCreated.length, 0, 'a flow scoped to a different Page must not trigger');
    assert.equal(identity.sendCalls.length, 0);
  } finally {
    flowService.handleInboundMessage = originalHandleInboundMessage;
    identity.restore();
    restoreModels();
  }
});

// 4. A WhatsApp-only flow does not trigger from Messenger (regression guard).
test('a WhatsApp-only flow (channels=NULL, channel=whatsapp) does not trigger from a Messenger message', async () => {
  const flow = { ...productionShapedFlow(), channels: null, facebookPageId: null };
  const flowRunsCreated = [];
  const contact = { id: 503, firstName: 'Sam', toJSON: () => ({ id: 503 }) };
  const conversation = { id: 779, leadId: 1, facebookPageId: 9, toJSON: () => ({ id: 779 }), async update() {} };
  const restoreModels = patchModelMethods(standardMocks({ flow, flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });
  let capturedPromise = null;
  const originalHandleInboundMessage = flowService.handleInboundMessage;
  flowService.handleInboundMessage = (...args) => { capturedPromise = originalHandleInboundMessage.apply(flowService, args); return capturedPromise; };
  try {
    const page = { id: 9, pageId: '106024052262867' };
    const item = { sender: { id: 'psid-wa-only-1' }, message: { mid: 'mid-e2e-3', text: 'hello' }, timestamp: String(Date.now()) };
    await facebookMessengerService.handleInboundMessagingEvent(page, item);
    await new Promise((resolve) => setImmediate(resolve));
    if (capturedPromise) await capturedPromise;
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(flowRunsCreated.length, 0);
  } finally {
    flowService.handleInboundMessage = originalHandleInboundMessage;
    identity.restore();
    restoreModels();
  }
});

// Reproduces the likely production gotcha explicitly: the "Create Flow"
// dialog defaults triggerKeywords to "start", which silently restricts an
// otherwise-generic-looking flow to messages containing that exact word.
test('a flow left with the Create-Flow-dialog default keyword ("start") does NOT trigger on unrelated text — proves the keyword gate, not a code bug, explains a silent non-trigger', async () => {
  const flow = productionShapedFlow({ keywords: ['start'] });
  const flowRunsCreated = [];
  const contact = { id: 504, firstName: 'Sam', toJSON: () => ({ id: 504 }) };
  const conversation = { id: 780, leadId: 1, facebookPageId: 9, toJSON: () => ({ id: 780 }), async update() {} };
  const restoreModels = patchModelMethods(standardMocks({ flow, flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });
  let capturedPromise = null;
  const originalHandleInboundMessage = flowService.handleInboundMessage;
  flowService.handleInboundMessage = (...args) => { capturedPromise = originalHandleInboundMessage.apply(flowService, args); return capturedPromise; };
  try {
    const page = { id: 9, pageId: '106024052262867' };
    const item = { sender: { id: 'psid-keyword-1' }, message: { mid: 'mid-e2e-4', text: 'Hi there, need help with pricing' }, timestamp: String(Date.now()) };
    await facebookMessengerService.handleInboundMessagingEvent(page, item);
    await new Promise((resolve) => setImmediate(resolve));
    if (capturedPromise) await capturedPromise;
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(flowRunsCreated.length, 0, 'a message not containing "start" correctly does not match a keyword-restricted trigger');
    assert.equal(identity.sendCalls.length, 0);
  } finally {
    flowService.handleInboundMessage = originalHandleInboundMessage;
    identity.restore();
    restoreModels();
  }
});
