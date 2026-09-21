const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Conversation, Student } = require('../src/models');
const conversationAccessService = require('../src/services/conversationAccess.service');
const inboxService = require('../src/services/inbox.service');

const originals = {
  findAll: Conversation.findAll,
  count: Conversation.count,
  sequelizeQuery: sequelize.query,
  studentFindAll: Student.findAll,
  whereForUser: conversationAccessService.whereForUser,
  attachInteractionRates: inboxService.attachInteractionRates,
  listConversations: inboxService.listConversations
};

test.afterEach(() => {
  Conversation.findAll = originals.findAll;
  Conversation.count = originals.count;
  sequelize.query = originals.sequelizeQuery;
  Student.findAll = originals.studentFindAll;
  conversationAccessService.whereForUser = originals.whereForUser;
  inboxService.attachInteractionRates = originals.attachInteractionRates;
  inboxService.listConversations = originals.listConversations;
});

function pageRow(id, effectiveLastMessageAt) {
  return { id, get: (key) => (key === 'effectiveLastMessageAt' ? effectiveLastMessageAt : undefined) };
}

function hydratedRow(id, overrides = {}) {
  const data = {
    id, contactId: 900 + id, assignedUserId: null, assignedRoleId: null,
    unreadCount: 0, lastInboundAt: null, assignee: null, assignedUser: null,
    ...overrides
  };
  return { ...data, toJSON: () => data };
}

test('listConversations() fetches the latest message via a bounded per-conversation query, not an unbounded scan', async () => {
  const rows = [pageRow(1, 't1'), pageRow(2, 't2')];
  let findAllCallCount = 0;
  Conversation.findAll = async (opts) => {
    findAllCallCount += 1;
    if (findAllCallCount === 1) return rows;
    return [hydratedRow(1), hydratedRow(2)];
  };
  Conversation.count = async () => 2;
  Student.findAll = async () => [];
  conversationAccessService.whereForUser = async () => ({});

  let capturedSql = null;
  let capturedReplacements = null;
  sequelize.query = async (sql, options) => {
    capturedSql = sql;
    capturedReplacements = options.replacements;
    // Simulates what Postgres' DISTINCT ON already guarantees: exactly one
    // (the newest) row per conversation, never the full history.
    return [
      { id: 501, conversationId: 1, direction: 'inbound', text: 'Hi from 1 (newest)', createdAt: '2024-01-02T00:00:00Z' },
      { id: 601, conversationId: 2, direction: 'outbound', text: 'Hi from 2 (newest)', createdAt: '2024-01-03T00:00:00Z' }
    ];
  };

  const result = await inboxService.listConversations({}, { id: 1, isSystemAdmin: true });

  assert.match(capturedSql, /DISTINCT ON \(conversation_id\)/);
  assert.match(capturedSql, /deleted_at IS NULL/);
  assert.match(capturedSql, /conversation_id IN \(:conversationIds\)/);
  assert.deepEqual(capturedReplacements.conversationIds, [1, 2]);

  assert.equal(result.items.length, 2);
  assert.equal(result.items.find((item) => item.id === 1).lastMessage.text, 'Hi from 1 (newest)');
  assert.equal(result.items.find((item) => item.id === 2).lastMessage.text, 'Hi from 2 (newest)');
});

test('listConversations() list path never computes interactionRate (that scan is reserved for the single-conversation view)', async () => {
  Conversation.findAll = async (opts, idx) => (Conversation.findAll.calls = (Conversation.findAll.calls || 0) + 1) && (
    Conversation.findAll.calls === 1 ? [pageRow(1, 't1')] : [hydratedRow(1)]
  );
  Conversation.count = async () => 1;
  Student.findAll = async () => [];
  conversationAccessService.whereForUser = async () => ({});
  sequelize.query = async () => [];

  let interactionRateCalled = false;
  inboxService.attachInteractionRates = async (conversations) => { interactionRateCalled = true; return conversations; };

  await inboxService.listConversations({}, { id: 1, isSystemAdmin: true });
  assert.equal(interactionRateCalled, false);
});

test('listConversations() with countsOnly skips the row/message/summary pipeline and returns filteredTotal', async () => {
  conversationAccessService.whereForUser = async () => ({});
  Conversation.count = async () => 7;
  let findAllCalled = false;
  Conversation.findAll = async () => { findAllCalled = true; return []; };
  let queryCalled = false;
  sequelize.query = async () => { queryCalled = true; return []; };
  let studentCalled = false;
  Student.findAll = async () => { studentCalled = true; return []; };

  const result = await inboxService.listConversations({ countsOnly: true }, { id: 1, isSystemAdmin: true });

  assert.deepEqual(result, { items: [], nextCursor: null, hasMore: false, total: 7, filteredTotal: 7 });
  assert.equal(findAllCalled, false, 'countsOnly must not fetch conversation rows');
  assert.equal(queryCalled, false, 'countsOnly must not fetch messages');
  assert.equal(studentCalled, false, 'countsOnly must not fetch student summaries');
});

test('counts() resolves the access scope once and reuses it across all four window sub-queries', async () => {
  let whereForUserCalls = 0;
  conversationAccessService.whereForUser = async () => { whereForUserCalls += 1; return { some: 'scope' }; };

  const seenCalls = [];
  inboxService.listConversations = async (query) => {
    seenCalls.push(query);
    return { items: [], nextCursor: null, hasMore: false, total: 10, filteredTotal: 3 };
  };

  const result = await inboxService.counts({}, { id: 1, isSystemAdmin: true });

  assert.equal(whereForUserCalls, 1, 'counts() must resolve the access scope exactly once, not once per sub-query');
  assert.equal(seenCalls.length, 4);
  for (const call of seenCalls) {
    assert.equal(call.countsOnly, true);
    assert.deepEqual(call.precomputedScopeWhere, { some: 'scope' });
  }
  assert.deepEqual(result, { total: 3, inside: 3, outside: 3, closing: 3 });
});

test('a restricted (non-admin, no allWhatsappAccounts) user still gets an AND-scoped where clause, not an unscoped one', async () => {
  // Guards the double-scopedWhere-call dedupe: the resolved scope must still
  // be applied to BOTH permissionWhere and the filtered where exactly as
  // conversationAccessService.scopedWhere() did before.
  const restrictedScope = { whatsappAccountId: { fakeOp: [10, 11] } };
  conversationAccessService.whereForUser = async () => restrictedScope;

  let capturedPermissionWhere = null;
  let capturedFilteredWhere = null;
  let call = 0;
  Conversation.count = async (opts) => {
    call += 1;
    if (call === 1) capturedPermissionWhere = opts.where;
    else capturedFilteredWhere = opts.where;
    return 0;
  };
  Conversation.findAll = async () => [];
  sequelize.query = async () => [];
  Student.findAll = async () => [];

  await inboxService.listConversations({ countsOnly: true }, { id: 2 });

  const Op = require('sequelize').Op;
  assert.ok(capturedPermissionWhere[Op.and], 'permissionWhere must be AND-combined with the restricted scope');
  assert.ok(capturedFilteredWhere[Op.and], 'the filtered where must be AND-combined with the restricted scope');
  assert.deepEqual(capturedPermissionWhere[Op.and][1], restrictedScope);
  assert.deepEqual(capturedFilteredWhere[Op.and][1], restrictedScope);
});
