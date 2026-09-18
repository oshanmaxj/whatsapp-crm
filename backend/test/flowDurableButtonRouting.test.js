const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const flowService = require('../src/services/flow.service');
const facebookMessengerService = require('../src/services/facebookMessenger.service');
const facebookConversationIdentityService = require('../src/services/facebookConversationIdentity.service');
const whatsappService = require('../src/services/whatsapp.service');
const messagingWindowService = require('../src/services/messagingWindow.service');
const outboundHistoryService = require('../src/services/outboundHistory.service');

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

// A durable "main menu" style interactive message: three independent
// CONTINUE_FLOW buttons, each branching to its own distinct reply node —
// exactly the shape described in the reported Scenario A/B examples
// ("Course Details" / "Contact Us" / "Main Menu").
function menuFlow(overrides = {}) {
  return {
    id: 501, name: 'Main Menu', status: 'published', channel: 'facebook_messenger', channels: null,
    whatsappAccountId: null, facebookPageId: 9,
    nodes: [
      {
        id: 1, nodeKey: 'n1', nodeType: 'button_message', label: 'Menu', stats: {},
        configJson: {
          message: 'Choose an option',
          buttons: [
            { id: 'a', title: 'Course Details', primaryActionType: 'CONTINUE_FLOW' },
            { id: 'b', title: 'Contact Us', primaryActionType: 'CONTINUE_FLOW' },
            { id: 'c', title: 'Main Menu', primaryActionType: 'CONTINUE_FLOW' }
          ]
        }
      },
      { id: 2, nodeKey: 'nodeA', nodeType: 'text_message', label: 'Course Details Reply', stats: {}, configJson: { message: 'Here are the course details.' } },
      { id: 3, nodeKey: 'nodeB', nodeType: 'text_message', label: 'Contact Us Reply', stats: {}, configJson: { message: 'Contact us at 555-1234.' } },
      { id: 4, nodeKey: 'nodeC', nodeType: 'text_message', label: 'Main Menu Reply', stats: {}, configJson: { message: 'Returning to main menu.' } }
    ],
    connections: [
      { sourceNodeKey: 'n1', sourceHandle: 'a', targetNodeKey: 'nodeA' },
      { sourceNodeKey: 'n1', sourceHandle: 'b', targetNodeKey: 'nodeB' },
      { sourceNodeKey: 'n1', sourceHandle: 'c', targetNodeKey: 'nodeC' }
    ],
    ...overrides
  };
}

// An unrelated, currently-active question flow — used to prove an old menu
// button never hijacks a different live waiting run for the same contact.
function questionFlow() {
  return {
    id: 601, name: 'Ask course interest', status: 'published', channel: 'facebook_messenger', channels: null,
    whatsappAccountId: null, facebookPageId: 9,
    nodes: [
      { id: 10, nodeKey: 'ask', nodeType: 'user_input', label: 'Ask', stats: {}, configJson: { question: 'What is your name?', saveAs: 'name' } }
    ],
    connections: []
  };
}

function makeFlowRunStore(initialRows = []) {
  const rows = [...initialRows];
  let nextId = 2000;
  return {
    rows,
    async create(data) {
      const row = { id: nextId++, waitingForReply: false, ...data, async update(patch) { Object.assign(row, patch); return row; } };
      rows.push(row);
      return row;
    },
    async findOne({ where }) {
      if (Object.prototype.hasOwnProperty.call(where, 'lastWhatsappMessageId') && !Object.prototype.hasOwnProperty.call(where, 'flowId')) {
        return rows.find((r) => r.lastWhatsappMessageId && String(r.lastWhatsappMessageId) === String(where.lastWhatsappMessageId)) || null;
      }
      if (where.status === 'waiting') {
        const candidates = rows.filter((r) => r.status === 'waiting' && r.waitingForReply && String(r.contactId) === String(where.contactId));
        const scoped = candidates.filter((r) => (where.channel !== undefined
          ? String(r.channel) === String(where.channel) && String(r.facebookPageId || '') === String(where.facebookPageId || '')
          : String(r.whatsappAccountId || '') === String(where.whatsappAccountId || '')));
        return scoped[scoped.length - 1] || null;
      }
      if (Object.prototype.hasOwnProperty.call(where, 'flowId') && Object.prototype.hasOwnProperty.call(where, 'lastWhatsappMessageId')) {
        return rows.find((r) => String(r.flowId) === String(where.flowId) && r.lastWhatsappMessageId && String(r.lastWhatsappMessageId) === String(where.lastWhatsappMessageId)) || null;
      }
      return null;
    },
    async findByPk(id) { return rows.find((r) => r.id === Number(id)) || null; }
  };
}

function baseModelMocks({ flows, flowRunStore, labelCalls = [] }) {
  const flowById = new Map(flows.map((flow) => [flow.id, flow]));
  return {
    'Flow.findOne': async ({ where }) => flowById.get(Number(where.id)) || null,
    'Flow.findAll': async () => [],
    'FlowRun.create': (data) => flowRunStore.create(data),
    'FlowRun.findOne': (options) => flowRunStore.findOne(options),
    'FlowRun.findByPk': (id) => flowRunStore.findByPk(id),
    'FlowRunLog.create': async () => ({}),
    'FlowNode.update': async () => [1],
    'FlowRunLink.findOne': async () => null,
    'FlowRunLink.findOrCreate': async ({ defaults }) => [defaults, true],
    'FlowActionExecution.findOrCreate': async ({ defaults }) => [{ ...defaults, async update(patch) { Object.assign(this, patch); } }, true],
    'ConversationLabel.findOrCreate': async ({ where }) => { labelCalls.push(where.labelId); return [{}, true]; },
    'Contact.findByPk': async (id) => ({ id: Number(id), firstName: 'Sam', toJSON: () => ({ id: Number(id) }) }),
    'Conversation.findByPk': async (id) => ({ id: Number(id), facebookPageId: 9, contactId: 501, toJSON: () => ({ id: Number(id) }), async update() {} }),
    'Lead.findByPk': async () => null,
    'Message.count': async () => 1
  };
}

function patchFacebookSend() {
  const originals = {
    sendTextMessage: facebookMessengerService.sendTextMessage,
    sendButtonMessage: facebookMessengerService.sendButtonMessage
  };
  const calls = { sendTextMessage: [], sendButtonMessage: [] };
  facebookMessengerService.sendTextMessage = async (args) => { calls.sendTextMessage.push(args); return { id: 1, facebookMessageId: 'fbmid-text' }; };
  facebookMessengerService.sendButtonMessage = async (args) => { calls.sendButtonMessage.push(args); return { id: 2, facebookMessageId: 'fbmid-button' }; };
  return { calls, restore() { facebookMessengerService.sendTextMessage = originals.sendTextMessage; facebookMessengerService.sendButtonMessage = originals.sendButtonMessage; } };
}

function payload(flowId, nodeKey, buttonId) {
  return flowService.encodedButtonId(flowId, nodeKey, buttonId);
}

const contact = { id: 501, toJSON: () => ({ id: 501 }) };
const conversation = { id: 777, facebookPageId: 9, toJSON: () => ({ id: 777 }) };

// ---------------------------------------------------------------------------
// 1 & Scenario A — an old button (sent long ago) still resolves to its
// original action after several unrelated text messages in between.
// ---------------------------------------------------------------------------
test('1 (Scenario A): pressing an old menu button after 3 intervening text messages still executes its action', async () => {
  const flow = menuFlow();
  const flowRunStore = makeFlowRunStore();
  const restore = patchModelMethods(baseModelMocks({ flows: [flow], flowRunStore }));
  const fb = patchFacebookSend();
  try {
    // Three unrelated plain-text messages arrive first, with no waiting run
    // for this contact at all (simulating the interactive message's run
    // having already completed or never having been tracked as waiting).
    for (const text of ['hi', 'are you open today?', 'ok thanks']) {
      const result = await flowService.handleInboundMessage({
        text, contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9,
        whatsappMessageId: `mid-text-${text}`, matchNewTriggers: false
      });
      assert.equal(result, null, 'plain text with no waiting run and matchNewTriggers:false must be a no-op');
    }

    const result = await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9,
      whatsappMessageId: 'mid-old-button-a'
    });
    assert.ok(result, 'the old button click must resolve to a run');
    assert.equal(fb.calls.sendTextMessage.length, 1, 'the Course Details branch must actually send');
    assert.equal(fb.calls.sendTextMessage[0].text, 'Here are the course details.');
  } finally { fb.restore(); restore(); }
});

// ---------------------------------------------------------------------------
// 2 & 3 & Scenario B — Button A executes, then Button B and Button C from
// the SAME original message each independently execute their own branch.
// ---------------------------------------------------------------------------
test('2/3 (Scenario B): Button A, then B, then C from the same original message each execute their own correct branch', async () => {
  const flow = menuFlow();
  const flowRunStore = makeFlowRunStore();
  const restore = patchModelMethods(baseModelMocks({ flows: [flow], flowRunStore }));
  const fb = patchFacebookSend();
  try {
    await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-btn-a'
    });
    await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'b'), buttonPayload: payload(501, 'n1', 'b'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-btn-b'
    });
    await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'c'), buttonPayload: payload(501, 'n1', 'c'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-btn-c'
    });
    assert.equal(fb.calls.sendTextMessage.length, 3, 'all three buttons on the same original message must each independently execute');
    assert.deepEqual(fb.calls.sendTextMessage.map((call) => call.text), [
      'Here are the course details.', 'Contact us at 555-1234.', 'Returning to main menu.'
    ]);
    // Each button click produced its OWN isolated FlowRun — Button A being
    // used did not consume or block Button B/C.
    assert.equal(flowRunStore.rows.length, 3);
  } finally { fb.restore(); restore(); }
});

// ---------------------------------------------------------------------------
// 4 & 18 — duplicate delivery of the same button webhook executes only once.
// ---------------------------------------------------------------------------
test('4/18: duplicate webhook delivery of the same button press executes its action only once', async () => {
  const flow = menuFlow();
  const flowRunStore = makeFlowRunStore();
  const restore = patchModelMethods(baseModelMocks({ flows: [flow], flowRunStore }));
  const fb = patchFacebookSend();
  try {
    const first = await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-dup-a'
    });
    const second = await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-dup-a'
    });
    assert.ok(first); assert.ok(second);
    assert.equal(fb.calls.sendTextMessage.length, 1, 'the exact same inbound webhook message id must never execute the action twice');
    assert.equal(second.id, first.id, 'the duplicate must resolve to the already-created run, not a new one');
  } finally { fb.restore(); restore(); }
});

// ---------------------------------------------------------------------------
// 5 — two DISTINCT intentional presses of the same button both execute
// (documented "reusable" policy — see report).
// ---------------------------------------------------------------------------
test('5: two distinct intentional presses of the same button both execute (reusable policy)', async () => {
  const flow = menuFlow();
  const flowRunStore = makeFlowRunStore();
  const restore = patchModelMethods(baseModelMocks({ flows: [flow], flowRunStore }));
  const fb = patchFacebookSend();
  try {
    await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-press-1'
    });
    await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-press-2'
    });
    assert.equal(fb.calls.sendTextMessage.length, 2, 'two genuinely distinct physical presses (different inbound message ids) must each execute independently');
  } finally { fb.restore(); restore(); }
});

// ---------------------------------------------------------------------------
// 6 & 7 — an old menu button must never hijack a DIFFERENT, currently active
// waiting run for the same contact (e.g. a live user_input question).
// ---------------------------------------------------------------------------
test('6/7: an old menu button click never disturbs an unrelated currently-active waiting run', async () => {
  const flow = menuFlow();
  const otherFlow = questionFlow();
  const activeWaitingRun = {
    id: 999, flowId: otherFlow.id, contactId: contact.id, status: 'waiting', waitingForReply: true, waitingNodeKey: 'ask',
    channel: 'facebook_messenger', facebookPageId: 9, contextJson: {},
    async update(patch) { Object.assign(this, patch); return this; }
  };
  const flowRunStore = makeFlowRunStore([activeWaitingRun]);
  const restore = patchModelMethods(baseModelMocks({ flows: [flow, otherFlow], flowRunStore }));
  const fb = patchFacebookSend();
  try {
    await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'b'), buttonPayload: payload(501, 'n1', 'b'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-old-btn-b'
    });
    assert.equal(activeWaitingRun.status, 'waiting', 'the unrelated active run must remain untouched');
    assert.equal(activeWaitingRun.waitingNodeKey, 'ask', 'the unrelated run must still be waiting at its own node');
    assert.equal(fb.calls.sendTextMessage.length, 1, 'the old button must still execute its own action, in an isolated run');
    assert.equal(fb.calls.sendTextMessage[0].text, 'Contact us at 555-1234.');
  } finally { fb.restore(); restore(); }
});

// ---------------------------------------------------------------------------
// 7 (contact isolation) — a button click always executes against the
// contact who actually sent the webhook, never some other contact.
// ---------------------------------------------------------------------------
test('7: a button click always resolves for the actual sending contact, never a different one', async () => {
  const flow = menuFlow();
  const flowRunStore = makeFlowRunStore();
  const restore = patchModelMethods(baseModelMocks({ flows: [flow], flowRunStore }));
  const fb = patchFacebookSend();
  try {
    const contactX = { id: 900, toJSON: () => ({ id: 900 }) };
    const contactY = { id: 901, toJSON: () => ({ id: 901 }) };
    await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact: contactX, lead: null, conversation: { id: 1001, toJSON: () => ({ id: 1001 }) },
      channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-contact-x'
    });
    await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact: contactY, lead: null, conversation: { id: 1002, toJSON: () => ({ id: 1002 }) },
      channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-contact-y'
    });
    assert.equal(flowRunStore.rows[0].contactId, 900);
    assert.equal(flowRunStore.rows[1].contactId, 901);
  } finally { fb.restore(); restore(); }
});

// ---------------------------------------------------------------------------
// 8 — a button belonging to a flow scoped to a DIFFERENT Facebook Page (or
// WhatsApp account) must be refused, never executed.
// ---------------------------------------------------------------------------
test('8: an old button scoped to a different Facebook Page is refused', async () => {
  const flow = menuFlow({ facebookPageId: 12345 });
  const flowRunStore = makeFlowRunStore();
  const restore = patchModelMethods(baseModelMocks({ flows: [flow], flowRunStore }));
  const fb = patchFacebookSend();
  try {
    const result = await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-wrong-page'
    });
    assert.equal(result, null, 'a button whose flow belongs to a different Page must be refused, not executed');
    assert.equal(fb.calls.sendTextMessage.length, 0);
  } finally { fb.restore(); restore(); }
});

// ---------------------------------------------------------------------------
// 9 — editing the flow so the button/node no longer exists (a genuinely
// unsafe, removed action) never resolves to a stale action.
// ---------------------------------------------------------------------------
test('9: a button removed by a later flow edit fails safely instead of resolving to something else', async () => {
  const editedFlow = menuFlow();
  editedFlow.nodes[0].configJson.buttons = editedFlow.nodes[0].configJson.buttons.filter((button) => button.id !== 'a');
  const flowRunStore = makeFlowRunStore();
  const restore = patchModelMethods(baseModelMocks({ flows: [editedFlow], flowRunStore }));
  const fb = patchFacebookSend();
  try {
    const result = await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-removed-button'
    });
    assert.equal(result, null, 'a removed button must never fall back to executing a different current button');
    assert.equal(fb.calls.sendTextMessage.length, 0);
  } finally { fb.restore(); restore(); }
});

// ---------------------------------------------------------------------------
// 10 — the entire node deleted from the flow fails safely.
// ---------------------------------------------------------------------------
test('10: a deleted node fails safely', async () => {
  const editedFlow = menuFlow();
  editedFlow.nodes = editedFlow.nodes.filter((node) => node.nodeKey !== 'n1');
  const flowRunStore = makeFlowRunStore();
  const restore = patchModelMethods(baseModelMocks({ flows: [editedFlow], flowRunStore }));
  const fb = patchFacebookSend();
  try {
    const result = await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-deleted-node'
    });
    assert.equal(result, null);
    assert.equal(fb.calls.sendTextMessage.length, 0);
  } finally { fb.restore(); restore(); }
});

// ---------------------------------------------------------------------------
// 11 — an unpublished flow's old button is explicitly refused.
// ---------------------------------------------------------------------------
test('11: an unpublished flow refuses an old button click, explicitly and safely', async () => {
  const unpublished = menuFlow({ status: 'draft' });
  const flowRunStore = makeFlowRunStore();
  const restore = patchModelMethods(baseModelMocks({ flows: [unpublished], flowRunStore }));
  const fb = patchFacebookSend();
  try {
    const result = await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-unpublished'
    });
    assert.equal(result, null, 'an unpublished flow must never let an old button execute');
    assert.equal(fb.calls.sendTextMessage.length, 0);
  } finally { fb.restore(); restore(); }
});

// ---------------------------------------------------------------------------
// 12 — WhatsApp action/menu buttons work the same way.
// ---------------------------------------------------------------------------
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

test('12: an old WhatsApp menu button still resolves and sends via the WhatsApp adapter', async () => {
  const flow = menuFlow({ id: 502, channel: 'whatsapp', facebookPageId: null, whatsappAccountId: 2 });
  const flowRunStore = makeFlowRunStore();
  const restore = patchModelMethods(baseModelMocks({ flows: [flow], flowRunStore }));
  const wa = patchWhatsAppSend();
  try {
    const waConversation = { id: 778, whatsappAccountId: 2, toJSON: () => ({ id: 778 }), async update() {} };
    const restoreConversation = patchModelMethods({ 'Conversation.findByPk': async () => waConversation });
    try {
      const result = await flowService.handleInboundMessage({
        text: payload(502, 'n1', 'a'), buttonPayload: payload(502, 'n1', 'a'), interactiveType: 'button_reply',
        contact, lead: null, conversation: waConversation, channel: 'whatsapp', whatsappAccountId: 2, whatsappMessageId: 'wamid-old-button'
      });
      assert.ok(result);
      assert.equal(wa.sendCalls.length, 1);
      assert.equal(wa.sendCalls[0].text, 'Here are the course details.');
    } finally { restoreConversation(); }
  } finally { wa.restore(); restore(); }
});

// ---------------------------------------------------------------------------
// 13 — the Messenger postback entry point (real webhook shape) resolves an
// old button the same way as the direct handleInboundMessage call above.
// ---------------------------------------------------------------------------
test('13: a Messenger postback for an old/second button resolves through the real postback entry point', async () => {
  const flow = menuFlow();
  const flowRunStore = makeFlowRunStore();
  const restore = patchModelMethods(baseModelMocks({ flows: [flow], flowRunStore }));
  const fb = patchFacebookSend();
  const originalResolve = facebookConversationIdentityService.findOrCreateByPageAndPsid;
  facebookConversationIdentityService.findOrCreateByPageAndPsid = async () => ({ contact, conversation, facebookContact: {}, created: false });
  try {
    const page = { id: 9, pageId: '106024052262867' };
    const item = { sender: { id: 'psid-1' }, postback: { payload: payload(501, 'n1', 'c') }, timestamp: String(Date.now()) };
    const result = await facebookMessengerService.handleInboundPostbackEvent(page, item);
    assert.ok(result?.run, 'the postback must resolve to a run');
    assert.equal(fb.calls.sendTextMessage.length, 1);
    assert.equal(fb.calls.sendTextMessage[0].text, 'Returning to main menu.');
  } finally { facebookConversationIdentityService.findOrCreateByPageAndPsid = originalResolve; fb.restore(); restore(); }
});

// ---------------------------------------------------------------------------
// 14 — existing single-answer user_input behavior is unaffected (no stable
// button payload is involved at all for a plain free-text reply).
// ---------------------------------------------------------------------------
test('14: a plain free-text reply to a user_input node is unaffected by durable button routing', async () => {
  const flow = questionFlow();
  const waitingRun = {
    id: 3000, flowId: flow.id, contactId: contact.id, status: 'waiting', waitingForReply: true, waitingNodeKey: 'ask',
    channel: 'facebook_messenger', facebookPageId: 9, contextJson: {},
    async update(patch) { Object.assign(this, patch); return this; }
  };
  const flowRunStore = makeFlowRunStore([waitingRun]);
  const restore = patchModelMethods(baseModelMocks({ flows: [flow], flowRunStore }));
  try {
    const result = await flowService.handleInboundMessage({
      text: 'Oshan', contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-free-text'
    });
    assert.ok(result);
    assert.equal(waitingRun.contextJson.name, 'Oshan', 'the free-text answer must still be captured exactly as before');
  } finally { restore(); }
});

// ---------------------------------------------------------------------------
// 17 — an existing START_FLOW button action still works, and still starts an
// independent child run via the existing flowAction.service mechanism.
// ---------------------------------------------------------------------------
test('17: a durable START_FLOW button still starts an independent child flow correctly', async () => {
  const targetFlow = {
    id: 700, status: 'published', channel: 'facebook_messenger', channels: null, whatsappAccountId: null, facebookPageId: 9,
    nodes: [{ id: 20, nodeKey: 'childStart', nodeType: 'text_message', label: 'Child', stats: {}, configJson: { message: 'Child flow started.' } }],
    connections: []
  };
  const flow = menuFlow();
  flow.nodes[0].configJson.buttons[0] = { id: 'a', title: 'Course Details', primaryActionType: 'START_FLOW', primaryActionConfig: { targetFlowId: 700, stopCurrentFlow: true } };
  const flowRunStore = makeFlowRunStore();
  const restore = patchModelMethods(baseModelMocks({ flows: [flow, targetFlow], flowRunStore }));
  const fb = patchFacebookSend();
  try {
    const result = await flowService.handleInboundMessage({
      text: payload(501, 'n1', 'a'), buttonPayload: payload(501, 'n1', 'a'), interactiveType: 'button_reply',
      contact, lead: null, conversation, channel: 'facebook_messenger', facebookPageId: 9, whatsappMessageId: 'mid-start-flow-btn'
    });
    assert.ok(result);
    assert.equal(fb.calls.sendTextMessage.length, 1, 'the START_FLOW target flow must have executed its own node');
    assert.equal(fb.calls.sendTextMessage[0].text, 'Child flow started.');
    assert.equal(flowRunStore.rows.some((row) => row.flowId === 700), true, 'a separate child FlowRun must exist for the target flow');
  } finally { fb.restore(); restore(); }
});
