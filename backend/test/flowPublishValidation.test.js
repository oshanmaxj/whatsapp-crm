const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const flowService = require('../src/services/flow.service');

const node = (nodeKey, nodeType, configJson = {}, label = nodeKey) => ({ nodeKey, nodeType, configJson, label });
const edge = (sourceNodeKey, targetNodeKey, sourceHandle = 'next') => ({ sourceNodeKey, targetNodeKey, sourceHandle, targetHandle: 'input' });
const codes = (flow) => flowService.normalizeValidation(flow, flowService.validateFlow(flow)).errors.map((issue) => issue.code);

// A list_message node's Messenger feasibility (option count / description /
// title length — see flowListMessageMessenger.service.js) is a per-list
// design-time WARNING, not a blanket "unsupported node type" error, and only
// appears at all when the flow actually targets a Facebook channel.
test('a list_message node gets a Messenger-format warning only when the flow targets a Facebook channel', () => {
  const rows = [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }];
  const whatsappOnly = {
    channels: ['whatsapp'],
    nodes: [node('start', 'start'), node('menu', 'list_message', { message: 'Pick', rows })],
    connections: [edge('start', 'menu')]
  };
  const multiChannel = {
    channels: ['whatsapp', 'facebook_messenger'],
    nodes: [node('start', 'start'), node('menu', 'list_message', { message: 'Pick', rows })],
    connections: [edge('start', 'menu')]
  };
  const whatsappWarnings = flowService.normalizeValidation(whatsappOnly, flowService.validateFlow(whatsappOnly)).warnings;
  const multiChannelWarnings = flowService.normalizeValidation(multiChannel, flowService.validateFlow(multiChannel)).warnings;
  assert.ok(!whatsappWarnings.some((issue) => issue.nodeId === 'menu'), 'a WhatsApp-only flow needs no Messenger-format warning');
  assert.ok(multiChannelWarnings.some((issue) => issue.nodeId === 'menu' && /button template|quick repl|generic template/i.test(issue.message)));
});

test('a list_message node that cannot be represented on Messenger at all still gets a clear design-time warning, not a crash', () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({ id: `o${i}`, title: `Option ${i}` }));
  const flow = {
    channels: ['whatsapp', 'facebook_messenger'],
    nodes: [node('start', 'start'), node('menu', 'list_message', { message: 'Pick', rows })],
    connections: [edge('start', 'menu')]
  };
  const result = flowService.normalizeValidation(flow, flowService.validateFlow(flow));
  const warning = result.warnings.find((issue) => issue.nodeId === 'menu');
  assert.ok(warning, 'an unconvertible list still produces a warning instead of throwing out of validateFlow');
  assert.match(warning.message, /13/);
});

test('valid flow with an intentional terminal message passes graph validation', () => {
  const flow = {
    nodes: [node('start', 'start'), node('welcome', 'text_message', { message: 'Welcome' })],
    connections: [edge('start', 'welcome')]
  };
  assert.deepEqual(codes(flow), []);
});

test('validation returns stable node and field details for malformed graphs', () => {
  const flow = {
    nodes: [
      node('start', 'start'),
      node('question', 'interactive_message', { message: '', buttons: [{ id: 'yes', title: 'Yes' }] }, 'Question'),
      node('orphan', 'text_message', { message: 'Never reached' }, 'Orphan'),
      node('audio', 'audio_message', {}, 'Audio')
    ],
    connections: [edge('start', 'question'), edge('audio', 'deleted')]
  };
  const result = flowService.normalizeValidation(flow, flowService.validateFlow(flow));
  assert.ok(result.errors.some((issue) => issue.code === 'REQUIRED_FIELD_MISSING' && issue.nodeId === 'question'));
  assert.ok(result.errors.some((issue) => issue.code === 'INTERACTIVE_BUTTON_TARGET_MISSING' && issue.nodeId === 'question'));
  assert.ok(result.errors.some((issue) => issue.code === 'NODE_UNREACHABLE' && issue.nodeId === 'orphan'));
  assert.ok(result.errors.some((issue) => issue.code === 'EDGE_TARGET_MISSING'));
  assert.ok(result.errors.some((issue) => issue.code === 'MEDIA_REFERENCE_MISSING' && issue.nodeId === 'audio'));
  assert.ok(result.errors.every((issue) => issue.severity === 'error' && issue.message));
});

test('saved WhatsApp media IDs are valid for audio and video nodes', () => {
  const flow = {
    nodes: [
      node('start', 'start'),
      node('video', 'video_message', { whatsappMediaId: 'media-video' }),
      node('audio', 'audio_message', { whatsappMediaId: 'media-audio' })
    ],
    connections: [edge('start', 'video'), edge('video', 'audio')]
  };
  assert.deepEqual(codes(flow), []);
});

test('publish contract preserves mappings and does not update status before validation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/flow.service.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(__dirname, '../../frontend/src/pages/FlowBuilderEditorPage.jsx'), 'utf8');
  assert.match(source, /sourceHandle: edge\.sourceHandle \|\| null/);
  assert.match(source, /targetHandle: edge\.targetHandle \|\| null/);
  assert.ok(source.indexOf("code: 'FLOW_VALIDATION_FAILED'") < source.indexOf("flow.update({ status: 'published' })"));
  assert.match(frontend, /Validation issues/);
  assert.match(frontend, /Go to node/);
  assert.match(frontend, /instance\?\.fitView/);
  assert.match(frontend, /body\.errors/);
  assert.match(frontend, /sourceHandle: edge\.sourceHandle/);
  assert.match(frontend, /targetHandle: edge\.targetHandle/);
});
