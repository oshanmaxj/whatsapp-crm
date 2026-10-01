const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize } = require('../src/models');
const whatsappComplianceService = require('../src/services/whatsappCompliance.service');

const originalQuery = sequelize.query;
test.afterEach(() => { sequelize.query = originalQuery; });

// Canned, distinguishable responses for each of windowDashboard()'s six
// independent queries, keyed by a distinctive substring of each query's SQL
// so one mock can serve all of them without caring about call order.
function mockDashboardQueries({ captureCalls = null } = {}) {
  sequelize.query = async (sql, options) => {
    if (captureCalls) captureCalls.push({ sql, replacements: options.replacements });
    // Most-specific substrings checked first — the dedup query's SQL also
    // contains "qualified AND expires_at > NOW()" as part of its reused
    // free_entry_windows CTE, so that check must not shadow this one.
    if (sql.includes('DISTINCT c.contact_id')) return [{ count: '5' }];
    if (sql.includes('free_entry_windows few')) {
      return [{ status: 'pending', count: '1' }, { status: 'sent', count: '2' }, { status: 'delivered', count: '4' }, { status: 'read', count: '3' }, { status: 'failed', count: '1' }];
    }
    if (sql.includes('confirmed_free')) return [{ confirmed_free: '6', confirmed_billable: '4', unknown: '20' }];
    if (sql.includes('latest_inbound')) return [{ active: '3', expired: '2' }];
    if (sql.includes('qualified AND expires_at > NOW()')) return [{ active: '1', expired: '1' }];
    if (sql.includes("m.direction = 'outbound' AND m.deleted_at IS NULL AND m.channel = 'whatsapp'") && sql.includes('EXISTS')) {
      return [{ status: 'pending', count: '3' }, { status: 'sent', count: '10' }, { status: 'delivered', count: '8' }, { status: 'read', count: '5' }, { status: 'failed', count: '2' }];
    }
    throw new Error(`Unexpected query in test mock: ${sql.slice(0, 80)}`);
  };
}

test('windowDashboard reports a cumulative delivery funnel: attempted >= sent >= delivered >= read, failed kept separate', async () => {
  mockDashboardQueries();
  const result = await whatsappComplianceService.windowDashboard({ whatsappAccountId: 7 });
  // Mocked rows: pending=3, sent=10, delivered=8, read=5, failed=2.
  assert.equal(result.serviceWindow24h.activeConversations, 3);
  assert.equal(result.serviceWindow24h.expiredConversations, 2);
  assert.equal(result.serviceWindow24h.messages.attempted, 28, 'attempted must include every status, including pending and failed');
  assert.equal(result.serviceWindow24h.messages.sent, 23, 'sent = sent + delivered + read (23), never the old bug\'s 28-including-pending-and-failed');
  assert.equal(result.serviceWindow24h.messages.delivered, 13, 'delivered = delivered + read (13)');
  assert.equal(result.serviceWindow24h.messages.read, 5);
  assert.equal(result.serviceWindow24h.messages.failed, 2, 'failed is terminal and must never also be counted inside sent/delivered');

  // Mocked rows: pending=1, sent=2, delivered=4, read=3, failed=1.
  assert.equal(result.freeEntryWindow72h.activeConversations, 1);
  assert.equal(result.freeEntryWindow72h.expiredConversations, 1);
  assert.equal(result.freeEntryWindow72h.messages.attempted, 11);
  assert.equal(result.freeEntryWindow72h.messages.sent, 9);
  assert.equal(result.freeEntryWindow72h.messages.delivered, 7);
  assert.equal(result.freeEntryWindow72h.messages.read, 3);
  assert.equal(result.freeEntryWindow72h.messages.failed, 1);
});

test('a status with no rows at all reads as 0, not undefined or NaN', async () => {
  sequelize.query = async (sql) => {
    if (sql.includes('DISTINCT c.contact_id')) return [{ count: '0' }];
    if (sql.includes('free_entry_windows few')) return []; // no 72h messages at all for this account
    if (sql.includes('confirmed_free')) return [{ confirmed_free: '0', confirmed_billable: '0', unknown: '0' }];
    if (sql.includes('latest_inbound')) return [{ active: '0', expired: '0' }];
    if (sql.includes('qualified AND expires_at > NOW()')) return [{ active: '0', expired: '0' }];
    if (sql.includes('EXISTS')) return [];
    return [];
  };
  const result = await whatsappComplianceService.windowDashboard({ whatsappAccountId: 7 });
  assert.deepEqual(result.freeEntryWindow72h.messages, { attempted: 0, sent: 0, delivered: 0, read: 0, failed: 0 });
});

test('windowDashboard never sums the two active-conversation counts into "unique customers" — it returns the dedicated deduplicated query result', async () => {
  mockDashboardQueries();
  const result = await whatsappComplianceService.windowDashboard({ whatsappAccountId: 7 });
  // 3 (24h active) + 1 (72h active) = 4, but the mocked dedup query returns 5 —
  // proving the field is NOT computed as a sum of the two active counts.
  assert.equal(result.uniqueActiveCustomers, 5);
  assert.notEqual(result.uniqueActiveCustomers, result.serviceWindow24h.activeConversations + result.freeEntryWindow72h.activeConversations);
});

test('windowDashboard classifies pricing into confirmed-free / confirmed-billable / unknown without assuming anything', async () => {
  mockDashboardQueries();
  const result = await whatsappComplianceService.windowDashboard({ whatsappAccountId: 7 });
  assert.equal(result.pricing.confirmedFree, 6);
  assert.equal(result.pricing.confirmedBillable, 4);
  assert.equal(result.pricing.unknown, 20);
});

test('a specific whatsappAccountId scopes every query to that one account only', async () => {
  const calls = [];
  mockDashboardQueries({ captureCalls: calls });
  await whatsappComplianceService.windowDashboard({ whatsappAccountId: 42 });
  assert.ok(calls.length >= 5, 'every sub-query should have run');
  for (const call of calls) {
    assert.ok(call.sql.includes(':whatsappAccountId') || !call.sql.includes('whatsapp_account_id'), `query should scope by the specific account: ${call.sql.slice(0, 60)}`);
    if (call.sql.includes(':whatsappAccountId')) assert.equal(call.replacements.whatsappAccountId, 42);
  }
});

test('an array of accessible account IDs scopes every query to exactly those accounts via IN (), coerced to numbers', async () => {
  const calls = [];
  mockDashboardQueries({ captureCalls: calls });
  await whatsappComplianceService.windowDashboard({ _accessibleAccountIds: ['3', '9'] });
  const scoped = calls.filter((call) => call.sql.includes(':accountIds'));
  assert.ok(scoped.length > 0, 'at least one query should use the accountIds array scope');
  for (const call of scoped) {
    assert.deepEqual(call.replacements.accountIds, [3, 9]);
    assert.ok(call.sql.includes('IN (:accountIds)'), 'must use IN (), never ANY(::bigint[]) — see the comment on accountScope() for why ANY renders as invalid SQL for a named replacement');
    assert.ok(!call.sql.includes('ANY('), 'ANY(:accountIds...) must never appear — Sequelize renders a named-replacement array as a bare comma list, which breaks ANY()');
  }
});

// Regression guard for the exact bug this was shipped with: ANY(:ids::bigint[])
// looks plausible but Sequelize's named-replacement renderer (verified
// directly against lib/utils/sql.js, no database needed) turns a JS array
// into a bare "3, 9" comma list, never a Postgres array literal — so
// ANY(:ids::bigint[]) would actually execute as the invalid `ANY(3, 9::bigint[])`.
test('accountScope\'s rendered SQL is verified against Sequelize\'s real injectReplacements, not just assumed', () => {
  const { injectReplacements } = require('sequelize/lib/utils/sql');
  const { Sequelize } = require('sequelize');
  const dialect = new Sequelize('postgres://u:p@localhost:5432/d', { logging: false }).dialect;

  const broken = injectReplacements('SELECT 1 WHERE id = ANY(:accountIds::bigint[])', dialect, { accountIds: [3, 9] });
  assert.equal(broken, 'SELECT 1 WHERE id = ANY(3, 9::bigint[])', 'documents exactly why the old ANY() form was broken');

  const fixed = injectReplacements('SELECT 1 WHERE id IN (:accountIds)', dialect, { accountIds: [3, 9] });
  assert.equal(fixed, 'SELECT 1 WHERE id IN (3, 9)');
});

test('an empty accessible-account list (no authorized accounts) matches nothing rather than falling back to "all accounts"', async () => {
  const calls = [];
  mockDashboardQueries({ captureCalls: calls });
  await whatsappComplianceService.windowDashboard({ _accessibleAccountIds: [] });
  const guarded = calls.filter((call) => call.sql.includes('whatsapp_account_id = -1'));
  assert.ok(guarded.length > 0, 'an empty authorized set must produce a never-true filter, not an unscoped query');
});

test('an unrestricted caller (_accessibleAccountIds: null, no whatsappAccountId) runs with no account filter at all', async () => {
  const calls = [];
  mockDashboardQueries({ captureCalls: calls });
  const result = await whatsappComplianceService.windowDashboard({ _accessibleAccountIds: null });
  assert.equal(result.scope, 'all');
  for (const call of calls) {
    assert.ok(!call.sql.includes(':whatsappAccountId') && !call.sql.includes(':accountIds'), 'no account-scoping replacement should be used when unrestricted');
  }
});
