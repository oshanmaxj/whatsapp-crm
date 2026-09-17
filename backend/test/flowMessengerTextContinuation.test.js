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

// "Which course are you interested in?" flow: a waiting user_input node,
// followed by a condition node that branches on the captured reply into one
// of two label actions — this proves both that the reply text resumes the
// run AND that the correct value reaches downstream branch logic, not just
// that "some" continuation happened.
function courseFlow() {
  return {
    id: 20, status: 'published', channel: 'facebook_messenger', channels: null,
    whatsappAccountId: null, facebookPageId: 9,
    nodes: [
      { id: 1, nodeKey: 'ask', nodeType: 'user_input', label: 'Ask course', stats: {}, configJson: { question: 'Which course are you interested in?', saveAs: 'answer' } },
      { id: 2, nodeKey: 'branch', nodeType: 'condition', label: 'Branch on answer', stats: {}, configJson: { field: 'answer', value: 'trading' } },
      { id: 3, nodeKey: 'trading_label', nodeType: 'add_label', label: 'Label as Trading', stats: {}, configJson: { labelIds: [101] } },
      { id: 4, nodeKey: 'other_label', nodeType: 'add_label', label: 'Label as Other', stats: {}, configJson: { labelIds: [202] } }
    ],
    connections: [
      { sourceNodeKey: 'ask', sourceHandle: 'reply', targetNodeKey: 'branch' },
      { sourceNodeKey: 'branch', conditionLabel: 'true', targetNodeKey: 'trading_label' },
      { sourceNodeKey: 'branch', conditionLabel: 'false', targetNodeKey: 'other_label' }
    ]
  };
}

function makeWaitingRun({ id = 700, contactId = 501, conversationId = 55, channel = 'facebook_messenger', facebookPageId = 9, lastWhatsappMessageId = null } = {}) {
  const run = {
    id, flowId: 20, contactId, status: 'waiting', waitingForReply: true, waitingNodeKey: 'ask',
    channel, facebookPageId, lastWhatsappMessageId,
    contextJson: { flowId: 20, channel, facebookPageId, contactId, conversationId },
    async update(patch) { Object.assign(this, patch); return this; }
  };
  return run;
}

function commonMocks(waitingRun, flow, labelCalls) {
  return {
    'FlowRun.findOne': async ({ where }) => {
      if (where.lastWhatsappMessageId !== undefined) {
        return waitingRun.lastWhatsappMessageId && String(waitingRun.lastWhatsappMessageId) === String(where.lastWhatsappMessageId) ? waitingRun : null;
      }
      if (where.status === 'waiting') {
        const scopeMatches = where.channel !== undefined
          ? (String(where.channel) === String(waitingRun.channel) && String(where.facebookPageId) === String(waitingRun.facebookPageId))
          : true;
        return waitingRun.status === 'waiting' && String(where.contactId) === String(waitingRun.contactId) && scopeMatches ? waitingRun : null;
      }
      return null;
    },
    'FlowRun.findByPk': async (id) => (Number(id) === waitingRun.id ? waitingRun : null),
    'Flow.findOne': async ({ where }) => (Number(where.id) === flow.id ? flow : null),
    'FlowNode.update': async () => [1],
    'FlowRunLog.create': async () => ({}),
    'Contact.findByPk': async () => ({ id: 501, tags: [], toJSON: () => ({ id: 501 }), async update(patch) { Object.assign(this, patch); return this; } }),
    'Lead.findByPk': async () => null,
    'Conversation.findByPk': async () => ({ id: 55, toJSON: () => ({ id: 55 }), assignedUser: null, assignedRole: null, async update(patch) { Object.assign(this, patch); return this; } }),
    'ConversationLabel.findOrCreate': async ({ where }) => { labelCalls.push(where.labelId); return [{}, true]; }
  };
}

test('scenario: a waiting Messenger user_input run resumes from inbound text and the reply value drives the correct condition branch', async () => {
  const waitingRun = makeWaitingRun();
  const flow = courseFlow();
  const labelCalls = [];
  const restore = patchModelMethods(commonMocks(waitingRun, flow, labelCalls));
  try {
    const result = await flowService.handleInboundMessage({
      text: 'Trading', contact: { id: 501, toJSON: () => ({ id: 501 }) }, lead: null,
      whatsappMessageId: 'mid-course-1', channel: 'facebook_messenger', facebookPageId: 9, matchNewTriggers: false
    });
    assert.ok(result, 'expected the waiting run to resume');
    assert.equal(waitingRun.contextJson.answer, 'Trading', 'the captured reply value must be exactly what the user typed');
    assert.deepEqual(labelCalls, [101], 'the "trading" branch label must be applied, not the "other" one');
  } finally { restore(); }
});

test('a different reply value drives the other branch, proving the value (not just presence) controls continuation', async () => {
  const waitingRun = makeWaitingRun();
  const flow = courseFlow();
  const labelCalls = [];
  const restore = patchModelMethods(commonMocks(waitingRun, flow, labelCalls));
  try {
    await flowService.handleInboundMessage({
      text: 'Baking', contact: { id: 501, toJSON: () => ({ id: 501 }) }, lead: null,
      whatsappMessageId: 'mid-course-2', channel: 'facebook_messenger', facebookPageId: 9, matchNewTriggers: false
    });
    assert.equal(waitingRun.contextJson.answer, 'Baking');
    assert.deepEqual(labelCalls, [202]);
  } finally { restore(); }
});

test('an unrelated Messenger message with no waiting run does not resume anything and reports null, leaving new-trigger matching to the caller', async () => {
  const waitingRun = makeWaitingRun({ id: 701 });
  waitingRun.status = 'completed'; // no run is actually waiting for this contact
  const flow = courseFlow();
  const restore = patchModelMethods(commonMocks(waitingRun, flow, []));
  try {
    const result = await flowService.handleInboundMessage({
      text: 'What are your prices?', contact: { id: 501, toJSON: () => ({ id: 501 }) }, lead: null,
      whatsappMessageId: 'mid-unrelated-1', channel: 'facebook_messenger', facebookPageId: 9, matchNewTriggers: false
    });
    assert.equal(result, null, 'with matchNewTriggers:false and no waiting run, the function must return null rather than guessing');
  } finally { restore(); }
});

test('a waiting run scoped to a different Facebook Page is not incorrectly resumed', async () => {
  const waitingRun = makeWaitingRun({ facebookPageId: 999 }); // waiting, but for a different Page
  const flow = courseFlow();
  const restore = patchModelMethods(commonMocks(waitingRun, flow, []));
  try {
    const result = await flowService.handleInboundMessage({
      text: 'Trading', contact: { id: 501, toJSON: () => ({ id: 501 }) }, lead: null,
      whatsappMessageId: 'mid-wrong-page-1', channel: 'facebook_messenger', facebookPageId: 9, matchNewTriggers: false
    });
    assert.equal(result, null, 'a run waiting for a different Page must not be treated as a match');
  } finally { restore(); }
});

test('a waiting run scoped to WhatsApp is not incorrectly resumed by a Messenger message for the same contact', async () => {
  const waitingRun = makeWaitingRun({ channel: 'whatsapp', facebookPageId: null });
  const flow = courseFlow();
  const restore = patchModelMethods(commonMocks(waitingRun, flow, []));
  try {
    const result = await flowService.handleInboundMessage({
      text: 'Trading', contact: { id: 501, toJSON: () => ({ id: 501 }) }, lead: null,
      whatsappMessageId: 'mid-cross-channel-1', channel: 'facebook_messenger', facebookPageId: 9, matchNewTriggers: false
    });
    assert.equal(result, null, 'a WhatsApp-scoped waiting run must not be resumed by a Messenger event for the same contact');
  } finally { restore(); }
});

test('duplicate delivery of the same Messenger message cannot advance a waiting run twice', async () => {
  const waitingRun = makeWaitingRun();
  const flow = courseFlow();
  const labelCalls = [];
  const restore = patchModelMethods(commonMocks(waitingRun, flow, labelCalls));
  try {
    const first = await flowService.handleInboundMessage({
      text: 'Trading', contact: { id: 501, toJSON: () => ({ id: 501 }) }, lead: null,
      whatsappMessageId: 'mid-dup-course-1', channel: 'facebook_messenger', facebookPageId: 9, matchNewTriggers: false
    });
    assert.ok(first);
    assert.equal(labelCalls.length, 1, 'the first delivery must apply the label once');

    const second = await flowService.handleInboundMessage({
      text: 'Trading', contact: { id: 501, toJSON: () => ({ id: 501 }) }, lead: null,
      whatsappMessageId: 'mid-dup-course-1', channel: 'facebook_messenger', facebookPageId: 9, matchNewTriggers: false
    });
    assert.ok(second, 'the duplicate resolves to the already-processed run, not an error');
    assert.equal(labelCalls.length, 1, 'the duplicate delivery must not apply the label a second time');
  } finally { restore(); }
});

test('WhatsApp waiting/reply behavior is completely unchanged: handleInboundMessage still defaults matchNewTriggers to true', async () => {
  const waitingRun = makeWaitingRun({ channel: 'whatsapp', facebookPageId: null });
  const flow = { ...courseFlow(), channel: 'whatsapp', channels: null, whatsappAccountId: 3, facebookPageId: null };
  const labelCalls = [];
  const restore = patchModelMethods(commonMocks(waitingRun, flow, labelCalls));
  try {
    // No matchNewTriggers passed at all — WhatsApp's existing call sites never set it.
    const result = await flowService.handleInboundMessage({
      text: 'Trading', contact: { id: 501, toJSON: () => ({ id: 501 }) }, lead: null,
      whatsappMessageId: 'mid-wa-course-1', whatsappAccountId: 3
    });
    assert.ok(result);
    assert.deepEqual(labelCalls, [101]);
  } finally { restore(); }
});

test('integration: an inbound Messenger text message checks for a waiting run before falling back to new-trigger domain-event matching', async () => {
  const waitingRun = makeWaitingRun();
  const flow = courseFlow();
  const labelCalls = [];
  const restoreModels = patchModelMethods({
    ...commonMocks(waitingRun, flow, labelCalls),
    'Message.findOne': async () => null,
    'Message.create': async (data) => ({ id: 1, ...data })
  });

  const originalResolve = facebookConversationIdentityService.findOrCreateByPageAndPsid;
  facebookConversationIdentityService.findOrCreateByPageAndPsid = async (values) => {
    const contact = { id: 501, toJSON: () => ({ id: 501 }) };
    const conversation = { id: 55, leadId: 1, toJSON: () => ({ id: 55 }), async update(patch) { Object.assign(this, patch); } };
    // Mirrors the real service: invoke afterResolve so resolved.persisted is
    // populated exactly like production, instead of short-circuiting
    // handleInboundMessagingEvent's `if (!messageRecord) return null;` guard.
    const persisted = values.afterResolve ? await values.afterResolve({ contact, conversation, facebookContact: {}, transaction: {} }) : null;
    return { contact, conversation, facebookContact: {}, created: true, persisted };
  };

  let domainEventCalled = false;
  const originalHandleDomainEvent = flowService.handleDomainEvent;
  flowService.handleDomainEvent = async (...args) => { domainEventCalled = true; return originalHandleDomainEvent.apply(flowService, args); };

  // The dispatch runs fire-and-forget via setImmediate; a fixed number of
  // drains is timing-fragile against a multi-await internal chain, so
  // instead capture the actual promise handleInboundMessage returns and
  // await it directly once the setImmediate callback has had a chance to start.
  let capturedPromise = null;
  const originalHandleInboundMessage = flowService.handleInboundMessage;
  flowService.handleInboundMessage = (...args) => {
    capturedPromise = originalHandleInboundMessage.apply(flowService, args);
    return capturedPromise;
  };

  try {
    const page = { id: 9, pageId: '106024052262867' };
    const item = { sender: { id: 'psid-course-1' }, message: { mid: 'mid-integration-1', text: 'Trading' }, timestamp: String(Date.now()) };
    await facebookMessengerService.handleInboundMessagingEvent(page, item);

    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(capturedPromise, 'handleInboundMessage must have been invoked by the dispatch');
    await capturedPromise;

    assert.deepEqual(labelCalls, [101], 'the waiting run must have been resumed and reached the correct branch');
    assert.equal(domainEventCalled, false, 'handleDomainEvent must not fire once the waiting run already consumed the message');
  } finally {
    facebookConversationIdentityService.findOrCreateByPageAndPsid = originalResolve;
    flowService.handleDomainEvent = originalHandleDomainEvent;
    flowService.handleInboundMessage = originalHandleInboundMessage;
    restoreModels();
  }
});
