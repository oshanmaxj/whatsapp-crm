const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');
const { Flow } = require('../src/models');
const whatsappAccountAccessService = require('../src/services/whatsappAccountAccess.service');
const facebookPageAccessService = require('../src/services/facebookPageAccess.service');
const flowService = require('../src/services/flow.service');

const originals = {
  findAll: Flow.findAll,
  userContext: whatsappAccountAccessService.userContext,
  whereForUser: whatsappAccountAccessService.whereForUser,
  fbUserContext: facebookPageAccessService.userContext
};

test.afterEach(() => {
  Flow.findAll = originals.findAll;
  whatsappAccountAccessService.userContext = originals.userContext;
  whatsappAccountAccessService.whereForUser = originals.whereForUser;
  facebookPageAccessService.userContext = originals.fbUserContext;
});

function stubRestrictedWhatsapp() {
  return { user: { roles: [{ id: 5 }] }, isAdmin: false, unrestricted: false, accountIds: ['10', '11'] };
}
function stubUnrestrictedFacebook() {
  return { user: {}, isAdmin: false, unrestricted: true, pageIds: [] };
}

test('flowService.list() resolves whatsapp account access exactly once per call, not twice (the original N+1 fix this file exists for)', async () => {
  let userContextCalls = 0;
  whatsappAccountAccessService.userContext = async () => { userContextCalls += 1; return stubRestrictedWhatsapp(); };
  let whereForUserCalls = 0;
  whatsappAccountAccessService.whereForUser = async (...args) => { whereForUserCalls += 1; return originals.whereForUser.apply(whatsappAccountAccessService, args); };
  facebookPageAccessService.userContext = async () => stubUnrestrictedFacebook();

  let capturedWhere = null;
  Flow.findAll = async (opts) => { capturedWhere = opts.where; return []; };

  await flowService.list(42);

  assert.equal(userContextCalls, 1, 'list() must resolve WhatsApp access context exactly once (previously called userContext() directly AND via whereForUser(), which calls userContext() internally)');
  assert.equal(whereForUserCalls, 0, 'list() must not call the separate whereForUser() helper now that it derives accessWhere from the single resolved context');
  assert.ok(capturedWhere, 'a where clause must still be built for a restricted user');
});

test('#22 flowService.list() resolves Facebook page access exactly once too — a second, genuinely distinct service, not a re-fetch of the WhatsApp context', async () => {
  whatsappAccountAccessService.userContext = async () => stubRestrictedWhatsapp();
  let fbCalls = 0;
  facebookPageAccessService.userContext = async () => { fbCalls += 1; return stubUnrestrictedFacebook(); };
  Flow.findAll = async () => [];

  await flowService.list(42);

  assert.equal(fbCalls, 1);
});

test('a restricted (non-admin) WhatsApp user gets an OR-with-null account scope — a specific account OR an unscoped/global flow, never a plain IN(...) that would exclude global flows', async () => {
  whatsappAccountAccessService.userContext = async () => stubRestrictedWhatsapp();
  facebookPageAccessService.userContext = async () => stubUnrestrictedFacebook();

  let capturedWhere = null;
  Flow.findAll = async (opts) => { capturedWhere = opts.where; return []; };
  await flowService.list(42);

  const clauses = capturedWhere[Op.and];
  assert.ok(Array.isArray(clauses));
  const whatsappScope = clauses.find((clause) => clause[Op.or]?.some((item) => 'whatsappAccountId' in item));
  assert.deepEqual(whatsappScope, { [Op.or]: [{ whatsappAccountId: null }, { whatsappAccountId: { [Op.in]: ['10', '11'] } }] });
});

test('#16/pre-existing-gap-fix: a WhatsApp-restricted user with unrestricted Facebook access is NOT excluded from Facebook-only flows — the old plain whatsappAccountId IN(...) where clause used to silently drop every null-account row, including Facebook flows', async () => {
  whatsappAccountAccessService.userContext = async () => stubRestrictedWhatsapp();
  facebookPageAccessService.userContext = async () => stubUnrestrictedFacebook();

  let capturedWhere = null;
  Flow.findAll = async (opts) => { capturedWhere = opts.where; return []; };
  await flowService.list(42);

  const clauses = capturedWhere[Op.and];
  const facebookScope = clauses.find((clause) => clause[Op.or]?.some((item) => 'facebookPageId' in item));
  // facebookContext.unrestricted === true here, so no facebookPageId
  // restriction clause should even be added — confirming it's not folded
  // into the whatsapp restriction and doesn't accidentally exclude anything.
  assert.equal(facebookScope, undefined, 'an unrestricted Facebook context must not add any facebookPageId clause at all');
});

test('a restricted Facebook user (unrestricted WhatsApp) gets a symmetric OR-with-null facebookPageId scope', async () => {
  whatsappAccountAccessService.userContext = async () => ({ user: { roles: [] }, isAdmin: true, unrestricted: true, accountIds: [] });
  facebookPageAccessService.userContext = async () => ({ user: {}, isAdmin: false, unrestricted: false, pageIds: ['7'] });

  let capturedWhere = null;
  Flow.findAll = async (opts) => { capturedWhere = opts.where; return []; };
  await flowService.list(42);

  assert.deepEqual(capturedWhere, { [Op.or]: [{ facebookPageId: null }, { facebookPageId: { [Op.in]: ['7'] } }] });
});

test('an unrestricted (admin / allWhatsappAccounts + allFacebookPages) user gets no restriction at all', async () => {
  whatsappAccountAccessService.userContext = async () => ({ user: { roles: [] }, isAdmin: true, unrestricted: true, accountIds: [] });
  facebookPageAccessService.userContext = async () => ({ user: {}, isAdmin: true, unrestricted: true, pageIds: [] });

  let capturedWhere = null;
  Flow.findAll = async (opts) => { capturedWhere = opts.where; return []; };
  await flowService.list(1);

  assert.deepEqual(capturedWhere, {});
});

test('an anonymous call (no userId) skips BOTH access resolutions entirely and returns all flows unscoped', async () => {
  let waCalled = false;
  let fbCalled = false;
  whatsappAccountAccessService.userContext = async () => { waCalled = true; return {}; };
  facebookPageAccessService.userContext = async () => { fbCalled = true; return {}; };

  let capturedWhere = null;
  Flow.findAll = async (opts) => { capturedWhere = opts.where; return []; };
  await flowService.list(null);

  assert.equal(waCalled, false);
  assert.equal(fbCalled, false);
  assert.deepEqual(capturedWhere, {});
});

// --- WhatsApp-number filter (Part 3/9) --------------------------------------

test('#11 filtering by a specific, authorized WhatsApp account scopes to that account OR an unscoped/global flow', async () => {
  whatsappAccountAccessService.userContext = async () => ({ user: { roles: [] }, isAdmin: true, unrestricted: true, accountIds: [] });
  facebookPageAccessService.userContext = async () => ({ user: {}, isAdmin: true, unrestricted: true, pageIds: [] });
  let capturedWhere = null;
  Flow.findAll = async (opts) => { capturedWhere = opts.where; return []; };

  await flowService.list(1, { whatsappAccountId: '10' });

  assert.deepEqual(capturedWhere, { [Op.or]: [{ whatsappAccountId: '10' }, { whatsappAccountId: null }] });
});

test('#13 a restricted user requesting an account outside their access is rejected with 403, without a second lookup (reuses the already-resolved context)', async () => {
  let userContextCalls = 0;
  whatsappAccountAccessService.userContext = async () => { userContextCalls += 1; return stubRestrictedWhatsapp(); };
  facebookPageAccessService.userContext = async () => stubUnrestrictedFacebook();
  Flow.findAll = async () => [];

  await assert.rejects(
    () => flowService.list(42, { whatsappAccountId: '999' }),
    (error) => { assert.equal(error.status, 403); return true; }
  );
  assert.equal(userContextCalls, 1, 'the 403 check must reuse the context already resolved for the base access scope, not call userContext() again');
});

test('a restricted user requesting an account THEY DO have access to is allowed through', async () => {
  whatsappAccountAccessService.userContext = async () => stubRestrictedWhatsapp();
  facebookPageAccessService.userContext = async () => stubUnrestrictedFacebook();
  let capturedWhere = null;
  Flow.findAll = async (opts) => { capturedWhere = opts.where; return []; };

  await flowService.list(42, { whatsappAccountId: '10' });

  const clauses = capturedWhere[Op.and];
  const requestedScope = clauses.find((clause) => clause[Op.or]?.some((item) => item.whatsappAccountId === '10'));
  assert.ok(requestedScope, 'the requested-account OR-null clause must be present');
});

test('#18 a global (null-account) Facebook-only flow is filtered OUT in JS when a specific WhatsApp account is requested — it must not masquerade as a global WhatsApp flow', async () => {
  whatsappAccountAccessService.userContext = async () => ({ user: { roles: [] }, isAdmin: true, unrestricted: true, accountIds: [] });
  facebookPageAccessService.userContext = async () => ({ user: {}, isAdmin: true, unrestricted: true, pageIds: [] });
  const facebookOnlyFlow = { id: 1, whatsappAccountId: null, facebookPageId: 5, channel: 'facebook_messenger', channels: null, toJSON() { return this; } };
  const globalWhatsappFlow = { id: 2, whatsappAccountId: null, facebookPageId: null, channel: 'whatsapp', channels: null, toJSON() { return this; } };
  const specificWhatsappFlow = { id: 3, whatsappAccountId: '10', facebookPageId: null, channel: 'whatsapp', channels: null, toJSON() { return this; } };
  Flow.findAll = async () => [facebookOnlyFlow, globalWhatsappFlow, specificWhatsappFlow];

  const result = await flowService.list(1, { whatsappAccountId: '10' });

  const ids = result.map((flow) => flow.id).sort();
  assert.deepEqual(ids, [2, 3], 'the Facebook-only flow (id 1) must be excluded; the global WhatsApp flow and the specific-account flow must both remain');
});

test('#17 "All numbers" (no filter) includes Facebook-only flows unchanged', async () => {
  whatsappAccountAccessService.userContext = async () => ({ user: { roles: [] }, isAdmin: true, unrestricted: true, accountIds: [] });
  facebookPageAccessService.userContext = async () => ({ user: {}, isAdmin: true, unrestricted: true, pageIds: [] });
  const facebookOnlyFlow = { id: 1, whatsappAccountId: null, facebookPageId: 5, channel: 'facebook_messenger', channels: null, toJSON() { return this; } };
  Flow.findAll = async () => [facebookOnlyFlow];

  const result = await flowService.list(1, {});

  assert.deepEqual(result.map((flow) => flow.id), [1]);
});
