const test = require('node:test');
const assert = require('node:assert/strict');
const whatsappAccountAccessService = require('../src/services/whatsappAccountAccess.service');
const whatsappComplianceService = require('../src/services/whatsappCompliance.service');
const complianceController = require('../src/controllers/compliance.controller');

const originals = {
  assertAccess: whatsappAccountAccessService.assertAccess,
  accessibleIds: whatsappAccountAccessService.accessibleIds,
  windowDashboard: whatsappComplianceService.windowDashboard
};
test.afterEach(() => {
  whatsappAccountAccessService.assertAccess = originals.assertAccess;
  whatsappAccountAccessService.accessibleIds = originals.accessibleIds;
  whatsappComplianceService.windowDashboard = originals.windowDashboard;
});

function fakeRes() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test('requesting a specific WhatsApp account the caller is NOT authorized for is blocked before windowDashboard ever runs (scenario 13)', async () => {
  whatsappAccountAccessService.assertAccess = async () => { throw Object.assign(new Error('You do not have access to this WhatsApp account'), { status: 403 }); };
  let dashboardCalled = false;
  whatsappComplianceService.windowDashboard = async () => { dashboardCalled = true; return {}; };

  const req = { query: { whatsappAccountId: '999' }, user: { id: 1 } };
  const res = fakeRes();
  let caughtError = null;
  await complianceController.whatsappWindows(req, res, (err) => { caughtError = err; });

  assert.equal(dashboardCalled, false, 'the dashboard aggregate must never run for an unauthorized account');
  assert.equal(caughtError?.status, 403);
});

test('requesting an authorized specific account scopes windowDashboard to exactly that account', async () => {
  let assertedAccountId = null;
  whatsappAccountAccessService.assertAccess = async (accountId) => { assertedAccountId = accountId; return accountId; };
  let receivedFilters = null;
  whatsappComplianceService.windowDashboard = async (filters) => { receivedFilters = filters; return { scope: 'account' }; };

  const req = { query: { whatsappAccountId: '7' }, user: { id: 1 } };
  const res = fakeRes();
  await complianceController.whatsappWindows(req, res, (err) => { throw err; });

  assert.equal(assertedAccountId, '7');
  assert.equal(receivedFilters.whatsappAccountId, '7');
  assert.equal(receivedFilters._accessibleAccountIds, null, 'a specific account request should not also apply the broader accessible-set filter');
  assert.equal(res.body.data.scope, 'account');
});

test('"All WhatsApp Numbers" (no whatsappAccountId) aggregates across exactly the caller\'s own accessible accounts — never another agent\'s restricted account', async () => {
  let accessibleIdsCalledFor = null;
  whatsappAccountAccessService.accessibleIds = async (userId) => { accessibleIdsCalledFor = userId; return ['3', '9']; };
  let receivedFilters = null;
  whatsappComplianceService.windowDashboard = async (filters) => { receivedFilters = filters; return { scope: 'accessible' }; };

  const req = { query: {}, user: { id: 42 } };
  const res = fakeRes();
  await complianceController.whatsappWindows(req, res, (err) => { throw err; });

  assert.equal(accessibleIdsCalledFor, 42);
  assert.equal(receivedFilters.whatsappAccountId, null);
  assert.deepEqual(receivedFilters._accessibleAccountIds, ['3', '9']);
});

test('an unrestricted (system admin) caller requesting "All" aggregates with no account restriction at all', async () => {
  whatsappAccountAccessService.accessibleIds = async () => null;
  let receivedFilters = null;
  whatsappComplianceService.windowDashboard = async (filters) => { receivedFilters = filters; return { scope: 'all' }; };

  const req = { query: {}, user: { id: 1, isSystemAdmin: true } };
  const res = fakeRes();
  await complianceController.whatsappWindows(req, res, (err) => { throw err; });

  assert.equal(receivedFilters._accessibleAccountIds, null);
});
