const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const flowService = require('../src/services/flow.service');

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

// Mirrors the production Flow 95 / Flow 91 shapes from
// facebookMessengerFlow95Reproduction.test.js, but only the fields
// triggerPriorityConflicts() actually reads.
function messengerFlow(id, overrides = {}) {
  return {
    id, name: `Flow ${id}`, status: 'published', channel: 'whatsapp', channels: ['whatsapp', 'facebook_messenger'],
    whatsappAccountId: 2, facebookPageId: 1,
    triggerType: 'inbound_message', triggerConfig: { source: 'inbound_message' },
    ...overrides
  };
}

test('no other published flows exist: no conflict warning', async () => {
  const restore = patchModelMethods({ 'Flow.findAll': async () => [] });
  try {
    const conflicts = await flowService.triggerPriorityConflicts(messengerFlow(95, { triggerConfig: { source: 'inbound_message', keywords: ['test'] } }));
    assert.deepEqual(conflicts, []);
  } finally { restore(); }
});

test('two published flows sharing channel/page scope at the same (default) priority produce a non-blocking warning', async () => {
  const flow91 = messengerFlow(91, { name: 'Trading Welcome', triggerConfig: { source: 'any_message' } });
  const restore = patchModelMethods({ 'Flow.findAll': async () => [flow91] });
  try {
    const flow95 = messengerFlow(95, { triggerConfig: { source: 'inbound_message', keywords: ['test'] } });
    const conflicts = await flowService.triggerPriorityConflicts(flow95);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].severity, 'warning', 'a trigger-priority conflict must never be a blocking error');
    assert.equal(conflicts[0].code, 'FLOW_TRIGGER_PRIORITY_CONFLICT');
    assert.match(conflicts[0].message, /Trading Welcome/);
    assert.match(conflicts[0].message, /Priority 100/);
  } finally { restore(); }
});

test('an explicit, distinct priority removes the conflict warning', async () => {
  const flow91 = messengerFlow(91, { triggerConfig: { source: 'any_message', priority: 100 } });
  const restore = patchModelMethods({ 'Flow.findAll': async () => [flow91] });
  try {
    const flow95 = messengerFlow(95, { triggerConfig: { source: 'inbound_message', keywords: ['test'], priority: 10 } });
    const conflicts = await flowService.triggerPriorityConflicts(flow95);
    assert.deepEqual(conflicts, [], 'a distinct priority means the two flows no longer race, so no warning is needed');
  } finally { restore(); }
});

test('a different Facebook Page (no scope overlap) produces no warning even at a tied priority', async () => {
  const otherPageFlow = messengerFlow(91, { facebookPageId: 999, whatsappAccountId: 55, triggerConfig: { source: 'any_message' } });
  const restore = patchModelMethods({ 'Flow.findAll': async () => [otherPageFlow] });
  try {
    const flow95 = messengerFlow(95, { triggerConfig: { source: 'inbound_message', keywords: ['test'] } });
    const conflicts = await flowService.triggerPriorityConflicts(flow95);
    assert.deepEqual(conflicts, []);
  } finally { restore(); }
});

test('a non-message trigger source (e.g. payment_event) is never flagged — conservative by design', async () => {
  const restore = patchModelMethods({ 'Flow.findAll': async () => [messengerFlow(91, { triggerConfig: { source: 'any_message' } })] });
  try {
    const paymentFlow = messengerFlow(95, { triggerConfig: { source: 'payment_event' } });
    const conflicts = await flowService.triggerPriorityConflicts(paymentFlow);
    assert.deepEqual(conflicts, []);
  } finally { restore(); }
});

test('normalizeValidation keeps a warning-severity issue out of errors, so it never blocks publish', () => {
  const flow = { nodes: [], connections: [] };
  const normalized = flowService.normalizeValidation(flow, [
    { severity: 'warning', message: 'Another published flow may match the same messages at Priority 100.' }
  ]);
  assert.equal(normalized.errors.length, 0);
  assert.equal(normalized.warnings.length, 1);
});
