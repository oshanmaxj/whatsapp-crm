const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const flowService = require('../src/services/flow.service');
const facebookMessengerService = require('../src/services/facebookMessenger.service');
const facebookConversationIdentityService = require('../src/services/facebookConversationIdentity.service');
const facebookPageService = require('../src/services/facebookPage.service');
const whatsappService = require('../src/services/whatsapp.service');
const messagingWindowService = require('../src/services/messagingWindow.service');
const outboundHistoryService = require('../src/services/outboundHistory.service');
const logger = require('../src/config/logger');

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

function fakeRun(id, extra = {}) {
  const run = { id, ...extra, async update(patch) { Object.assign(run, patch); return run; } };
  return run;
}

// Byte-for-byte the production row for Flow 95.
function flow95() {
  return {
    id: 95, name: 'test', status: 'published', channel: 'whatsapp', channels: ['whatsapp', 'facebook_messenger'],
    whatsappAccountId: 2, facebookPageId: 1, departmentId: null,
    triggerType: 'inbound_message', triggerKeywords: ['test'],
    triggerConfig: { source: 'inbound_message', keywords: ['test'], matchType: 'contains' },
    nodes: [
      { id: 1, nodeKey: 'start', nodeType: 'start', label: 'Start', stats: {}, configJson: {} },
      { id: 2, nodeKey: 'greet', nodeType: 'text_message', label: 'Greeting', stats: {}, configJson: { message: 'Thanks for testing!' } }
    ],
    connections: [{ sourceNodeKey: 'start', targetNodeKey: 'greet' }]
  };
}

// Byte-for-byte the production row for Flow 91.
function flow91() {
  return {
    id: 91, name: 'Trading Welcome Sinhala', status: 'published', channel: 'whatsapp', channels: ['whatsapp', 'facebook_messenger'],
    whatsappAccountId: 2, facebookPageId: 1, departmentId: null,
    triggerType: 'any_message', triggerKeywords: [],
    triggerConfig: { source: 'any_message' },
    nodes: [
      { id: 10, nodeKey: 'start', nodeType: 'start', label: 'Start', stats: {}, configJson: {} },
      { id: 11, nodeKey: 'welcome', nodeType: 'text_message', label: 'Welcome', stats: {}, configJson: { message: 'ආයුබෝවන්!' } }
    ],
    connections: [{ sourceNodeKey: 'start', targetNodeKey: 'welcome' }]
  };
}

function standardMocks({ flows, flowRunsCreated, contact, conversation }) {
  const flowById = new Map(flows.map((flow) => [flow.id, flow]));
  return {
    'FlowRun.findOne': async () => null,
    'FlowRun.create': async (data) => { const run = fakeRun(flowRunsCreated.length + 1, data); flowRunsCreated.push(run); return run; },
    'FlowRun.findByPk': async (id) => flowRunsCreated.find((run) => run.id === Number(id)) || null,
    'Flow.findAll': async () => flows,
    'Flow.findOne': async ({ where }) => flowById.get(Number(where.id)) || null,
    'FlowRunLog.create': async () => ({}),
    'FlowNode.update': async () => [1],
    'FacebookContact.findOne': async () => null,
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
  facebookPageService.runtimeConfig = async () => ({ pageId: '106024052262867', pageAccessToken: 'redacted', sendEnabled: true, facebookPageId: 1 });
  const originalSendText = facebookMessengerService.sendTextMessage;
  const sendCalls = [];
  facebookMessengerService.sendTextMessage = async (args) => { sendCalls.push(args); return { id: 999, facebookMessageId: 'fbmid-out' }; };
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

// Lets a WhatsApp text_message node run to completion (instead of throwing at
// the WHATSAPP_ACCOUNT_MISMATCH guard) so a test can prove more than one
// matched flow actually executes end-to-end, e.g. under stopAfterMatch=false.
function patchWhatsAppSend() {
  const originalAuthorize = messagingWindowService.authorizeSessionMessage;
  messagingWindowService.authorizeSessionMessage = async () => ({ allowed: true, messagingWindow: { isOpen: true }, template: null });
  const originalSendText = whatsappService.sendTextMessage;
  const sendCalls = [];
  whatsappService.sendTextMessage = async (args) => { sendCalls.push(args); return { id: 'wamid-out' }; };
  const originalRecord = outboundHistoryService.record;
  outboundHistoryService.record = async () => ({});
  return {
    sendCalls,
    restore() {
      messagingWindowService.authorizeSessionMessage = originalAuthorize;
      whatsappService.sendTextMessage = originalSendText;
      outboundHistoryService.record = originalRecord;
    }
  };
}

async function sendMessengerText({ text, mid, psid = 'psid-1', facebookPageId = 1 }) {
  const page = { id: facebookPageId, pageId: '106024052262867' };
  const item = { sender: { id: psid }, message: { mid, text }, timestamp: String(Date.now()) };
  // Both handleInboundMessage (waiting-run check) and, when it finds nothing,
  // handleDomainEvent (new-trigger matching) are awaited via captured spies —
  // never a guessed number of setImmediate drains — so this helper can never
  // return while either call is still in flight. Leaving one pending would
  // let it finish later, after restoreModels()/identity.restore() ran, and
  // clobber a LATER test's mocks (db.FlowRun.create etc. are shared globals
  // re-patched per test — a straggler landing after the next patch silently
  // pollutes that next test's assertions).
  let capturedInboundPromise = null;
  const originalHandleInboundMessage = flowService.handleInboundMessage;
  flowService.handleInboundMessage = (...args) => { capturedInboundPromise = originalHandleInboundMessage.apply(flowService, args); return capturedInboundPromise; };
  let capturedDomainEventPromise = null;
  const originalHandleDomainEvent = flowService.handleDomainEvent;
  flowService.handleDomainEvent = (...args) => { capturedDomainEventPromise = originalHandleDomainEvent.apply(flowService, args); return capturedDomainEventPromise; };
  try {
    await facebookMessengerService.handleInboundMessagingEvent(page, item);
    await new Promise((resolve) => setImmediate(resolve));
    if (capturedInboundPromise) await capturedInboundPromise.catch(() => null);
    await new Promise((resolve) => setImmediate(resolve));
    if (capturedDomainEventPromise) await capturedDomainEventPromise.catch(() => null);
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    flowService.handleInboundMessage = originalHandleInboundMessage;
    flowService.handleDomainEvent = originalHandleDomainEvent;
  }
}

// TASK B — Flow 95 in isolation: the channel/page/keyword-matching mechanism
// is correct on its own.
test('Task B: Flow 95 alone — "test" via Messenger creates exactly one FlowRun and reaches the first Text node', async () => {
  const flowRunsCreated = [];
  const contact = { id: 501, firstName: 'Sam', toJSON: () => ({ id: 501 }) };
  const conversation = { id: 777, leadId: 1, facebookPageId: 1, toJSON: () => ({ id: 777 }), async update() {} };
  const restoreModels = patchModelMethods(standardMocks({ flows: [flow95()], flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });
  try {
    await sendMessengerText({ text: 'test', mid: 'mid-95-1' });
    assert.equal(flowRunsCreated.length, 1, 'Flow 95 must be the sole candidate and must be started');
    assert.equal(flowRunsCreated[0].flowId, 95);
    assert.equal(identity.sendCalls.length, 1);
    assert.equal(identity.sendCalls[0].text, 'Thanks for testing!');
  } finally { identity.restore(); restoreModels(); }
});

test('Task B: "hello test please" matches contains matchType', async () => {
  const flowRunsCreated = [];
  const contact = { id: 502, firstName: 'Sam', toJSON: () => ({ id: 502 }) };
  const conversation = { id: 778, leadId: 1, facebookPageId: 1, toJSON: () => ({ id: 778 }), async update() {} };
  const restoreModels = patchModelMethods(standardMocks({ flows: [flow95()], flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });
  try {
    await sendMessengerText({ text: 'hello test please', mid: 'mid-95-2' });
    assert.equal(flowRunsCreated.length, 1);
  } finally { identity.restore(); restoreModels(); }
});

test('Task B: the wrong Facebook Page does not match Flow 95', async () => {
  const flowRunsCreated = [];
  const contact = { id: 503, firstName: 'Sam', toJSON: () => ({ id: 503 }) };
  const conversation = { id: 779, leadId: 1, facebookPageId: 999, toJSON: () => ({ id: 779 }), async update() {} };
  const restoreModels = patchModelMethods(standardMocks({ flows: [flow95()], flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });
  try {
    await sendMessengerText({ text: 'test', mid: 'mid-95-3', facebookPageId: 999 });
    assert.equal(flowRunsCreated.length, 0, 'a different Page must not trigger Flow 95');
  } finally { identity.restore(); restoreModels(); }
});

// executeFlow creates the FlowRun row before walking any node, so even
// though the WhatsApp text-send guard downstream legitimately rejects a
// context with no real conversation/account wiring (out of scope for this
// test — the WhatsApp send path itself is covered elsewhere), the run's
// creation — the thing scope-matching is actually being tested here — has
// already happened by the time that guard throws.
async function expectRunCreatedDespiteSendGuard(promise) {
  await assert.rejects(promise, (error) => error.code === 'WHATSAPP_ACCOUNT_MISMATCH');
}

test('Task B: a WhatsApp event for the same multi-channel flow still matches the WhatsApp scope', async () => {
  const flowRunsCreated = [];
  const restoreModels = patchModelMethods(standardMocks({ flows: [flow95()], flowRunsCreated, contact: null, conversation: null }));
  try {
    const contact = { id: 504, toJSON: () => ({ id: 504 }) };
    await expectRunCreatedDespiteSendGuard(flowService.handleDomainEvent({
      eventType: 'whatsapp_inbound', eventId: 'wa-mid-1', channel: 'whatsapp',
      whatsappAccountId: 2, contactId: 504, contact, text: 'test'
    }));
    assert.equal(flowRunsCreated.length, 1, 'the same multi-channel flow must still work for WhatsApp');
    assert.equal(flowRunsCreated[0].flowId, 95);
  } finally { restoreModels(); }
});

test('Task B: a legacy WhatsApp-only flow (channels=NULL) is unaffected', async () => {
  const legacyFlow = { ...flow95(), id: 96, channels: null, facebookPageId: null };
  const flowRunsCreated = [];
  const restoreModels = patchModelMethods(standardMocks({ flows: [legacyFlow], flowRunsCreated, contact: null, conversation: null }));
  try {
    const contact = { id: 505, toJSON: () => ({ id: 505 }) };
    await expectRunCreatedDespiteSendGuard(flowService.handleDomainEvent({ eventType: 'whatsapp_inbound', eventId: 'wa-mid-2', channel: 'whatsapp', whatsappAccountId: 2, contactId: 505, contact, text: 'test' }));
    assert.equal(flowRunsCreated.length, 1);

    // And it must NOT fire for a Facebook event of the same contact/page.
    const restore2 = patchModelMethods({ 'FlowRun.findOne': async () => null });
    await flowService.handleDomainEvent({ eventType: 'facebook_message_received', eventId: 'fb-mid-legacy', channel: 'facebook_messenger', facebookPageId: 1, contactId: 505, contact, text: 'test' });
    restore2();
    assert.equal(flowRunsCreated.length, 1, 'a channels=NULL flow must remain WhatsApp-only');
  } finally { restoreModels(); }
});

// TASK C — the actual production reproduction: Flow 91 (any_message) plus
// Flow 95 (keyword) both candidates for the same "test" message.
test('Task C (production reproduction): with Flow 91 (any_message) also a candidate, "test" starts only ONE flow — Flow 91 wins by insertion order under tied priority, explaining Flow 95\'s zero FlowRuns', async () => {
  const flowRunsCreated = [];
  const contact = { id: 506, firstName: 'Sam', toJSON: () => ({ id: 506 }) };
  const conversation = { id: 780, leadId: 1, facebookPageId: 1, toJSON: () => ({ id: 780 }), async update() {} };
  // Flow.findAll order matters here: no ORDER BY is specified in production
  // code, so this models the natural/insertion order (91 before 95) that a
  // real Postgres table without explicit ordering returns in practice.
  const restoreModels = patchModelMethods(standardMocks({ flows: [flow91(), flow95()], flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });
  try {
    await sendMessengerText({ text: 'test', mid: 'mid-both-1' });

    assert.equal(flowRunsCreated.length, 1, 'stopAfterMatch defaults to true, so only the first matched flow (by tied-priority insertion order) starts — this is pre-existing, not new, behavior');
    assert.equal(flowRunsCreated[0].flowId, 91, 'Flow 91 (any_message, lower id, same default priority) wins the tie and consumes the event before Flow 95 is ever reached');
    assert.equal(identity.sendCalls[0].text, 'ආයුබෝවන්!', 'Flow 91\'s own message is what actually gets sent — Flow 95\'s greeting never runs');
  } finally { identity.restore(); restoreModels(); }
});

test('Task C: if Flow 95 is given a lower (higher-precedence) priority than Flow 91, Flow 95 wins instead — proving priority, not code order, is the deterministic lever', async () => {
  const flowRunsCreated = [];
  const contact = { id: 507, firstName: 'Sam', toJSON: () => ({ id: 507 }) };
  const conversation = { id: 781, leadId: 1, facebookPageId: 1, toJSON: () => ({ id: 781 }), async update() {} };
  const prioritizedFlow95 = { ...flow95(), triggerConfig: { ...flow95().triggerConfig, priority: 10 } };
  const restoreModels = patchModelMethods(standardMocks({ flows: [flow91(), prioritizedFlow95], flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });
  try {
    await sendMessengerText({ text: 'test', mid: 'mid-priority-1' });
    assert.equal(flowRunsCreated.length, 1);
    assert.equal(flowRunsCreated[0].flowId, 95, 'an explicit lower priority number must win regardless of id/insertion order');
  } finally { identity.restore(); restoreModels(); }
});

test('Task C: Flow 91 alone (no Flow 95 present) still starts normally on any message', async () => {
  const flowRunsCreated = [];
  const contact = { id: 508, firstName: 'Sam', toJSON: () => ({ id: 508 }) };
  const conversation = { id: 782, leadId: 1, facebookPageId: 1, toJSON: () => ({ id: 782 }), async update() {} };
  const restoreModels = patchModelMethods(standardMocks({ flows: [flow91()], flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });
  try {
    await sendMessengerText({ text: 'anything at all', mid: 'mid-91-alone' });
    assert.equal(flowRunsCreated.length, 1);
    assert.equal(flowRunsCreated[0].flowId, 91);
  } finally { identity.restore(); restoreModels(); }
});

// TASK 6 — the exact scenarios requested for the new configurable-precedence
// feature: Flow 95 given the recommended explicit priority, with both
// stopAfterMatch settings, on Messenger.
test('Task 6: Flow 95 priority=10 + stopAfterMatch=true stops the loop — Flow 91 never runs', async () => {
  const flowRunsCreated = [];
  const contact = { id: 520, firstName: 'Sam', toJSON: () => ({ id: 520 }) };
  const conversation = { id: 790, leadId: 1, facebookPageId: 1, toJSON: () => ({ id: 790 }), async update() {} };
  const prioritizedFlow95 = { ...flow95(), triggerConfig: { ...flow95().triggerConfig, priority: 10, stopAfterMatch: true } };
  const restoreModels = patchModelMethods(standardMocks({ flows: [flow91(), prioritizedFlow95], flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });
  try {
    await sendMessengerText({ text: 'test', mid: 'mid-task6-a' });
    assert.equal(flowRunsCreated.length, 1, 'Flow 95 stopping after its own match must prevent Flow 91 from ever starting');
    assert.equal(flowRunsCreated[0].flowId, 95);
    assert.ok(!flowRunsCreated.some((run) => run.flowId === 91), 'Flow 91 must never appear among started runs');
  } finally { identity.restore(); restoreModels(); }
});

test('Task 6: Flow 95 priority=10 + stopAfterMatch=false lets Flow 91 also run, in priority order', async () => {
  const flowRunsCreated = [];
  const contact = { id: 521, firstName: 'Sam', toJSON: () => ({ id: 521 }) };
  const conversation = { id: 791, leadId: 1, facebookPageId: 1, toJSON: () => ({ id: 791 }), async update() {} };
  const prioritizedFlow95 = { ...flow95(), triggerConfig: { ...flow95().triggerConfig, priority: 10, stopAfterMatch: false } };
  const restoreModels = patchModelMethods(standardMocks({ flows: [flow91(), prioritizedFlow95], flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });
  try {
    await sendMessengerText({ text: 'test', mid: 'mid-task6-b' });
    assert.equal(flowRunsCreated.length, 2, 'stopAfterMatch=false on Flow 95 must let the next matching flow (91) also start');
    assert.equal(flowRunsCreated[0].flowId, 95, 'Flow 95 (priority 10) still runs first');
    assert.equal(flowRunsCreated[1].flowId, 91, 'Flow 91 (default priority 100) runs second, since Flow 95 did not stop the loop');
    assert.equal(identity.sendCalls.length, 2);
    assert.equal(identity.sendCalls[0].text, 'Thanks for testing!');
    assert.equal(identity.sendCalls[1].text, 'ආයුබෝවන්!');
  } finally { identity.restore(); restoreModels(); }
});

// TASK 9 — the same priority/stopAfterMatch mechanism must behave identically
// for WhatsApp, not just Facebook Messenger (both go through the same
// handleDomainEvent sort+break implementation).
test('Task 9 (WhatsApp): tied default priority — Flow 91 wins by insertion order, exactly like Messenger', async () => {
  const flowRunsCreated = [];
  const conversation = { id: 900, whatsappAccountId: 2, toJSON: () => ({ id: 900 }), async update() {} };
  const contact = { id: 522, toJSON: () => ({ id: 522 }) };
  const restoreModels = patchModelMethods(standardMocks({ flows: [flow91(), flow95()], flowRunsCreated, contact, conversation }));
  try {
    await expectRunCreatedDespiteSendGuard(flowService.handleDomainEvent({
      eventType: 'whatsapp_inbound', eventId: 'wa-mid-tie', channel: 'whatsapp',
      whatsappAccountId: 2, contactId: 522, contact, text: 'test'
    }));
    assert.equal(flowRunsCreated.length, 1, 'WhatsApp ties on default priority exactly like Facebook Messenger');
    assert.equal(flowRunsCreated[0].flowId, 91, 'Flow 91 wins the tie for WhatsApp too, by the same insertion-order rule');
  } finally { restoreModels(); }
});

test('Task 9 (WhatsApp): explicit priority + stopAfterMatch=false lets both matching flows start, in priority order', async () => {
  const flowRunsCreated = [];
  const conversation = { id: 901, whatsappAccountId: 2, toJSON: () => ({ id: 901 }), async update() {} };
  const contact = { id: 523, toJSON: () => ({ id: 523 }) };
  const prioritizedFlow95 = { ...flow95(), triggerConfig: { ...flow95().triggerConfig, priority: 10, stopAfterMatch: false } };
  const restoreModels = patchModelMethods(standardMocks({ flows: [flow91(), prioritizedFlow95], flowRunsCreated, contact, conversation }));
  const whatsapp = patchWhatsAppSend();
  try {
    await flowService.handleDomainEvent({
      eventType: 'whatsapp_inbound', eventId: 'wa-mid-both', channel: 'whatsapp',
      whatsappAccountId: 2, contactId: 523, contact, conversationId: 901, text: 'test'
    });
    assert.equal(flowRunsCreated.length, 2, 'stopAfterMatch=false must let the next matching flow also start for WhatsApp, exactly like Messenger');
    assert.equal(flowRunsCreated[0].flowId, 95, 'the lower priority number (10) runs first');
    assert.equal(flowRunsCreated[1].flowId, 91, 'the default-priority flow runs second, since Flow 95 did not stop the loop');
    assert.equal(whatsapp.sendCalls.length, 2);
    assert.equal(whatsapp.sendCalls[0].text, 'Thanks for testing!');
    assert.equal(whatsapp.sendCalls[1].text, 'ආයුබෝවන්!');
  } finally { whatsapp.restore(); restoreModels(); }
});

// TASK 7 — the flow_domain_event_evaluated structured log must accurately
// report which flows actually started, not just which ones matched.
test('Task 7: flow_domain_event_evaluated reports the real matched/started flow IDs, in order, with no message text logged', async () => {
  const flowRunsCreated = [];
  const contact = { id: 524, toJSON: () => ({ id: 524 }) };
  const conversation = { id: 902, facebookPageId: 1, toJSON: () => ({ id: 902 }), async update() {} };
  const prioritizedFlow95 = { ...flow95(), triggerConfig: { ...flow95().triggerConfig, priority: 10, stopAfterMatch: false } };
  const restoreModels = patchModelMethods(standardMocks({ flows: [flow91(), prioritizedFlow95], flowRunsCreated, contact, conversation }));
  const identity = patchIdentityAndSend({ contact, conversation });
  const originalInfo = logger.info;
  const logCalls = [];
  logger.info = (message, metadata) => { logCalls.push({ message, metadata }); return originalInfo.call(logger, message, metadata); };
  try {
    await flowService.handleDomainEvent({
      eventType: 'facebook_message_received', eventId: 'fb-mid-log-1', channel: 'facebook_messenger',
      facebookPageId: 1, contactId: 524, contact, conversationId: 902, text: 'test'
    });
    const entry = logCalls.find((call) => call.message === 'flow_domain_event_evaluated');
    assert.ok(entry, 'the structured log must be emitted');
    assert.deepEqual(entry.metadata.candidateFlowIds.slice().sort(), [91, 95]);
    assert.deepEqual(entry.metadata.matchedFlowIds, [95, 91], 'matched order reflects priority sort');
    assert.deepEqual(entry.metadata.startedFlowIds, [95, 91], 'both flows actually started because stopAfterMatch=false');
    assert.deepEqual(entry.metadata.skippedAsDuplicateFlowIds, []);
    assert.deepEqual(entry.metadata.rejectedFlowIds, []);
    assert.equal(entry.metadata.channel, 'facebook_messenger');
    assert.equal(entry.metadata.facebookPageId, 1);
    assert.equal(JSON.stringify(entry.metadata).includes('test'), false, 'the inbound message text must never be logged');
  } finally { logger.info = originalInfo; identity.restore(); restoreModels(); }
});
