const test = require('node:test');
const assert = require('node:assert/strict');
const { Flow } = require('../src/models');
const whatsappAccountAccessService = require('../src/services/whatsappAccountAccess.service');
const flowService = require('../src/services/flow.service');

const originals = {
  findAll: Flow.findAll,
  userContext: whatsappAccountAccessService.userContext,
  whereForUser: whatsappAccountAccessService.whereForUser
};

test.afterEach(() => {
  Flow.findAll = originals.findAll;
  whatsappAccountAccessService.userContext = originals.userContext;
  whatsappAccountAccessService.whereForUser = originals.whereForUser;
});

test('flowService.list() resolves whatsapp account access exactly once per call, not twice', async () => {
  let userContextCalls = 0;
  whatsappAccountAccessService.userContext = async () => {
    userContextCalls += 1;
    return { user: { roles: [{ id: 5 }] }, isAdmin: false, unrestricted: false, accountIds: ['10', '11'] };
  };
  let whereForUserCalls = 0;
  whatsappAccountAccessService.whereForUser = async (...args) => {
    whereForUserCalls += 1;
    return originals.whereForUser.apply(whatsappAccountAccessService, args);
  };

  let capturedWhere = null;
  Flow.findAll = async (opts) => { capturedWhere = opts.where; return []; };

  await flowService.list(42);

  assert.equal(userContextCalls, 1, 'list() must resolve access context exactly once (previously called userContext() directly AND via whereForUser(), which calls userContext() internally)');
  assert.equal(whereForUserCalls, 0, 'list() must not call the separate whereForUser() helper now that it derives accessWhere from the single resolved context');
  assert.ok(capturedWhere, 'a where clause must still be built for a restricted user');
});

test('a restricted (non-admin) user still gets a whatsappAccountId-scoped where clause identical to whereForUser()', async () => {
  const context = { user: { roles: [{ id: 5 }] }, isAdmin: false, unrestricted: false, accountIds: ['10', '11'] };
  whatsappAccountAccessService.userContext = async () => context;

  let capturedWhere = null;
  Flow.findAll = async (opts) => { capturedWhere = opts.where; return []; };
  await flowService.list(42);

  const Op = require('sequelize').Op;
  // Department scoping also applies for a non-admin user, so the where is
  // AND-combined — assert the account scope survived inside it unchanged.
  const accountScope = capturedWhere[Op.and] ? capturedWhere[Op.and][0] : capturedWhere;
  assert.deepEqual(accountScope, { whatsappAccountId: { [Op.in]: ['10', '11'] } });
});

test('an unrestricted (admin / allWhatsappAccounts) user gets no account restriction', async () => {
  whatsappAccountAccessService.userContext = async () => ({ user: { roles: [] }, isAdmin: true, unrestricted: true, accountIds: [] });

  let capturedWhere = null;
  Flow.findAll = async (opts) => { capturedWhere = opts.where; return []; };
  await flowService.list(1);

  assert.deepEqual(capturedWhere, {});
});

test('an anonymous call (no userId) skips access resolution entirely and returns all flows unscoped', async () => {
  let userContextCalled = false;
  whatsappAccountAccessService.userContext = async () => { userContextCalled = true; return {}; };

  let capturedWhere = null;
  Flow.findAll = async (opts) => { capturedWhere = opts.where; return []; };
  await flowService.list(null);

  assert.equal(userContextCalled, false);
  assert.deepEqual(capturedWhere, {});
});
