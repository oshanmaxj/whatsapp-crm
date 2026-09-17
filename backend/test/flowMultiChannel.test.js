const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const flowService = require('../src/services/flow.service');
const { matchesTrigger } = require('../src/services/flowTriggerMatcher.service');
const { flowChannels, isNodeSupportedOnChannel, isNodeSupportedOnChannels, nodeCompatibilityIssues } = require('../src/services/flowChannelCompatibility');

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

function whatsappFlow(overrides = {}) {
  return { channel: 'whatsapp', channels: null, whatsappAccountId: 3, triggerType: 'keyword', triggerKeywords: ['hello'], triggerConfig: { source: 'inbound_message' }, ...overrides };
}

// 1. Existing WhatsApp flow triggers unchanged.
test('scenario 1: an existing (pre-migration) WhatsApp flow still triggers on a matching WhatsApp keyword event', () => {
  const flow = whatsappFlow();
  assert.equal(matchesTrigger(flow, { channel: 'whatsapp', whatsappAccountId: 3, text: 'hello there' }), true);
});

// 2. Existing WhatsApp-only flow ignores Facebook.
test('scenario 2: a WhatsApp-only flow (channels=NULL) never matches a Facebook Messenger or Comment event', () => {
  const flow = whatsappFlow();
  assert.equal(matchesTrigger(flow, { channel: 'facebook_messenger', facebookPageId: 9, text: 'hello there' }), false);
  assert.equal(matchesTrigger(flow, { channel: 'facebook_comment', facebookPageId: 9, text: 'hello there' }), false);
});

// 3 & 4. Multi-channel flow triggers from both WhatsApp and Messenger.
test('scenarios 3 & 4: a flow with channels=[whatsapp, facebook_messenger] triggers from both channels', () => {
  const flow = { channel: 'whatsapp', channels: ['whatsapp', 'facebook_messenger'], whatsappAccountId: 3, facebookPageId: 9, triggerType: 'keyword', triggerKeywords: ['price'], triggerConfig: { source: 'inbound_message' } };
  assert.equal(matchesTrigger(flow, { channel: 'whatsapp', whatsappAccountId: 3, text: 'what is the price?' }), true);
  assert.equal(matchesTrigger(flow, { channel: 'facebook_messenger', facebookPageId: 9, text: 'what is the price?' }), true);
});

test('a multi-channel flow does not fire for a WhatsApp account it is not scoped to, even though it also supports Facebook', () => {
  const flow = { channel: 'whatsapp', channels: ['whatsapp', 'facebook_messenger'], whatsappAccountId: 3, facebookPageId: 9, triggerType: 'keyword', triggerKeywords: ['price'], triggerConfig: { source: 'inbound_message' } };
  assert.equal(matchesTrigger(flow, { channel: 'whatsapp', whatsappAccountId: 999, text: 'what is the price?' }), false);
});

test('a multi-channel flow does not fire for a Facebook Page it is not scoped to, even though it also supports WhatsApp', () => {
  const flow = { channel: 'whatsapp', channels: ['whatsapp', 'facebook_messenger'], whatsappAccountId: 3, facebookPageId: 9, triggerType: 'keyword', triggerKeywords: ['price'], triggerConfig: { source: 'inbound_message' } };
  assert.equal(matchesTrigger(flow, { channel: 'facebook_messenger', facebookPageId: 12345, text: 'what is the price?' }), false);
});

test('a multi-channel WhatsApp+Comments flow triggers from a comment and not from Messenger (Comments not selected)', () => {
  const flow = { channel: 'whatsapp', channels: ['whatsapp', 'facebook_comment'], whatsappAccountId: 3, facebookPageId: 9, triggerType: 'keyword', triggerConfig: { source: 'facebook_comment_keyword', matchType: 'exact' }, triggerKeywords: ['price'] };
  assert.equal(matchesTrigger(flow, { channel: 'facebook_comment', facebookPageId: 9, text: 'price' }), true);
  assert.equal(matchesTrigger(flow, { channel: 'facebook_messenger', facebookPageId: 9, text: 'price' }), false);
});

// 19. channels=NULL/legacy fallback is byte-for-byte the old single-channel rule.
test('scenario 19: flowChannels() falls back to the legacy single `channel` value whenever channels is NULL or empty', () => {
  assert.deepEqual(flowChannels({ channel: 'whatsapp', channels: null }), ['whatsapp']);
  assert.deepEqual(flowChannels({ channel: 'facebook_messenger', channels: [] }), ['facebook_messenger']);
  assert.deepEqual(flowChannels({ channel: null, channels: null }), ['whatsapp']); // matches the pre-migration `flow.channel || 'whatsapp'` default
  assert.deepEqual(flowChannels({ channel: 'whatsapp', channels: ['facebook_comment'] }), ['facebook_comment']); // channels wins when set
});

// 8 (design-time half): unsupported-node compatibility matrix.
test('scenario 8 (design-time): WhatsApp-only node types are flagged unsupported on Facebook channels', () => {
  for (const nodeType of ['whatsapp_flow', 'list_message', 'appointment_booking', 'location']) {
    assert.equal(isNodeSupportedOnChannel(nodeType, 'whatsapp'), true, `${nodeType} must remain supported on whatsapp`);
    assert.equal(isNodeSupportedOnChannel(nodeType, 'facebook_messenger'), false, `${nodeType} must be unsupported on facebook_messenger`);
    assert.equal(isNodeSupportedOnChannel(nodeType, 'facebook_comment'), false, `${nodeType} must be unsupported on facebook_comment`);
  }
  for (const nodeType of ['text_message', 'image_message', 'video_message', 'audio_message', 'file_document', 'button_message', 'interactive_message']) {
    assert.equal(isNodeSupportedOnChannel(nodeType, 'facebook_messenger'), true, `${nodeType} must be supported on facebook_messenger`);
  }
});

test('facebook_comment_reply is only supported on the facebook_comment channel', () => {
  assert.equal(isNodeSupportedOnChannel('facebook_comment_reply', 'facebook_comment'), true);
  assert.equal(isNodeSupportedOnChannel('facebook_comment_reply', 'facebook_messenger'), false);
  assert.equal(isNodeSupportedOnChannel('facebook_comment_reply', 'whatsapp'), false);
});

test('a node must be supported on every selected channel to count as fully compatible', () => {
  assert.equal(isNodeSupportedOnChannels('text_message', ['whatsapp', 'facebook_messenger']), true);
  assert.equal(isNodeSupportedOnChannels('location', ['whatsapp', 'facebook_messenger']), false, 'location works on whatsapp only, so a whatsapp+messenger flow is not fully compatible');
  assert.equal(isNodeSupportedOnChannels('location', ['whatsapp']), true);
});

test('nodeCompatibilityIssues produces one warning per unsupported node, not an error', () => {
  const flow = {
    channel: 'whatsapp', channels: ['whatsapp', 'facebook_messenger'],
    nodes: [
      { nodeKey: 'n1', nodeType: 'text_message', label: 'Say hi' },
      { nodeKey: 'n2', nodeType: 'location', label: 'Share office location' }
    ]
  };
  const issues = nodeCompatibilityIssues(flow);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].nodeKey, 'n2');
  assert.equal(issues[0].severity, 'warning');
  assert.equal(issues[0].code, 'FLOW_NODE_CHANNEL_UNSUPPORTED');
});

test('a single-channel WhatsApp flow gets no compatibility warnings for WhatsApp-only nodes', () => {
  const flow = { channel: 'whatsapp', channels: null, nodes: [{ nodeKey: 'n1', nodeType: 'location', label: 'Share location' }] };
  assert.deepEqual(nodeCompatibilityIssues(flow), []);
});

test('flow.service.saveBuilder persists a multi-channel selection (channels + facebookPageId) from the Flow Builder UI', async () => {
  const flowRow = { id: 10, name: 'Old name', channel: 'whatsapp', channels: null, facebookPageId: null, whatsappAccountId: 3, async update(patch) { Object.assign(this, patch); } };
  const restore = patchModelMethods({
    'sequelize.transaction': async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }),
    'Flow.findByPk': async (id) => (Number(id) === flowRow.id ? flowRow : null),
    'Flow.findOne': async () => flowRow,
    'FlowConnection.destroy': async () => 0,
    'FlowNode.destroy': async () => 0,
    'FlowNode.bulkCreate': async () => [],
    'FlowConnection.bulkCreate': async () => []
  });
  try {
    await flowService.saveBuilder(10, {
      flow: { name: 'Sales flow', channels: ['whatsapp', 'facebook_messenger'], facebookPageId: 77, whatsappAccountId: 3 },
      nodes: [], connections: []
    });
    assert.deepEqual(flowRow.channels, ['whatsapp', 'facebook_messenger']);
    assert.equal(flowRow.facebookPageId, 77);
  } finally { restore(); }
});

test('flow.service.saveBuilder leaves channels/facebookPageId untouched when the payload omits them (legacy WhatsApp-only save)', async () => {
  const flowRow = { id: 11, name: 'Legacy flow', channel: 'whatsapp', channels: null, facebookPageId: null, whatsappAccountId: 3, async update(patch) { Object.assign(this, patch); } };
  const restore = patchModelMethods({
    'sequelize.transaction': async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }),
    'Flow.findByPk': async (id) => (Number(id) === flowRow.id ? flowRow : null),
    'Flow.findOne': async () => flowRow,
    'FlowConnection.destroy': async () => 0,
    'FlowNode.destroy': async () => 0,
    'FlowNode.bulkCreate': async () => [],
    'FlowConnection.bulkCreate': async () => []
  });
  try {
    await flowService.saveBuilder(11, { flow: { name: 'Legacy flow renamed', whatsappAccountId: 3 }, nodes: [], connections: [] });
    assert.equal(flowRow.channels, null, 'omitting channels from the save payload must not clear an existing value or introduce one');
    assert.equal(flowRow.facebookPageId, null);
  } finally { restore(); }
});
