const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const flowService = require('../src/services/flow.service');
const whatsappAccountAccessService = require('../src/services/whatsappAccountAccess.service');
const facebookPageAccessService = require('../src/services/facebookPageAccess.service');

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

function patchAccessServices({ waResolve, waDept, fbResolve } = {}) {
  const waCalls = [];
  const fbCalls = [];
  const originals = {
    waResolve: whatsappAccountAccessService.resolveSelection,
    waDept: whatsappAccountAccessService.assertDepartmentAccess,
    fbResolve: facebookPageAccessService.resolveSelection
  };
  whatsappAccountAccessService.resolveSelection = async (...args) => { waCalls.push(args); return waResolve ? waResolve(...args) : null; };
  whatsappAccountAccessService.assertDepartmentAccess = async (...args) => (waDept ? waDept(...args) : null);
  facebookPageAccessService.resolveSelection = async (...args) => { fbCalls.push(args); return fbResolve ? fbResolve(...args) : null; };
  return {
    waCalls, fbCalls,
    restore() {
      whatsappAccountAccessService.resolveSelection = originals.waResolve;
      whatsappAccountAccessService.assertDepartmentAccess = originals.waDept;
      facebookPageAccessService.resolveSelection = originals.fbResolve;
    }
  };
}

function captureFlowCreate() {
  const calls = [];
  const restore = patchModelMethods({
    'Flow.create': async (data) => { const row = { id: 900 + calls.length, ...data }; calls.push(row); return row; },
    'Flow.findOne': async () => calls[calls.length - 1]
  });
  return { calls, restore };
}

test('a Facebook Messenger-only flow can be created without resolving any WhatsApp account', async () => {
  const access = patchAccessServices({ fbResolve: () => 77 });
  const { calls, restore } = captureFlowCreate();
  try {
    const created = await flowService.create({ name: 'Messenger flow', channels: ['facebook_messenger'] }, 5);
    assert.equal(access.waCalls.length, 0, 'whatsappAccountAccessService.resolveSelection must not be called for a Facebook-only flow');
    assert.equal(access.fbCalls.length, 1);
    assert.equal(calls[0].whatsappAccountId, null);
    assert.equal(calls[0].facebookPageId, 77);
    assert.equal(calls[0].channel, 'facebook_messenger');
    assert.equal(calls[0].channels, null, 'a single non-WhatsApp channel does not need the channels array');
    assert.equal(created.facebookPageId, 77);
  } finally { access.restore(); restore(); }
});

test('a Facebook Comments-only flow can be created without resolving any WhatsApp account', async () => {
  const access = patchAccessServices({ fbResolve: () => 88 });
  const { calls, restore } = captureFlowCreate();
  try {
    await flowService.create({ name: 'Comments flow', channels: ['facebook_comment'] }, 5);
    assert.equal(access.waCalls.length, 0);
    assert.equal(calls[0].whatsappAccountId, null);
    assert.equal(calls[0].facebookPageId, 88);
    assert.equal(calls[0].channel, 'facebook_comment');
  } finally { access.restore(); restore(); }
});

test('a WhatsApp-only flow still requires and resolves a WhatsApp account exactly as before', async () => {
  const access = patchAccessServices({ waResolve: () => 3 });
  const { calls, restore } = captureFlowCreate();
  try {
    const created = await flowService.create({ name: 'WhatsApp flow', channels: ['whatsapp'] }, 5);
    assert.equal(access.waCalls.length, 1);
    assert.equal(access.fbCalls.length, 0, 'facebookPageAccessService.resolveSelection must not be called for a WhatsApp-only flow');
    assert.equal(calls[0].whatsappAccountId, 3);
    assert.equal(calls[0].facebookPageId, null);
    assert.equal(created.whatsappAccountId, 3);
  } finally { access.restore(); restore(); }
});

test('a flow created with no channels field at all defaults to WhatsApp-only, matching pre-multi-channel behavior', async () => {
  const access = patchAccessServices({ waResolve: () => 3 });
  const { calls, restore } = captureFlowCreate();
  try {
    await flowService.create({ name: 'Legacy-style create' }, 5);
    assert.equal(access.waCalls.length, 1);
    assert.equal(access.fbCalls.length, 0);
    assert.equal(calls[0].channel, 'whatsapp');
    assert.equal(calls[0].channels, null);
  } finally { access.restore(); restore(); }
});

test('a multi-channel WhatsApp + Facebook Messenger flow resolves and saves both scopes', async () => {
  const access = patchAccessServices({ waResolve: () => 3, fbResolve: () => 77 });
  const { calls, restore } = captureFlowCreate();
  try {
    const created = await flowService.create({ name: 'Multi flow', channels: ['whatsapp', 'facebook_messenger'] }, 5);
    assert.equal(access.waCalls.length, 1);
    assert.equal(access.fbCalls.length, 1);
    assert.equal(calls[0].whatsappAccountId, 3);
    assert.equal(calls[0].facebookPageId, 77);
    assert.equal(calls[0].channel, 'whatsapp');
    assert.deepEqual(calls[0].channels, ['whatsapp', 'facebook_messenger']);
    assert.equal(created.facebookPageId, 77);
  } finally { access.restore(); restore(); }
});

test('a Facebook-only flow creation still propagates a "select a Page" error the same way WhatsApp does', async () => {
  const access = patchAccessServices({
    fbResolve: () => { throw Object.assign(new Error('Select a Facebook Page'), { status: 422 }); }
  });
  const { restore } = captureFlowCreate();
  try {
    await assert.rejects(
      flowService.create({ name: 'Ambiguous FB flow', channels: ['facebook_messenger'] }, 5),
      (error) => error.status === 422 && /Select a Facebook Page/.test(error.message)
    );
  } finally { access.restore(); restore(); }
});
