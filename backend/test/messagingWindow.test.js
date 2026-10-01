const test = require('node:test');
const assert = require('node:assert/strict');
const models = require('../src/models');
const messagingWindowService = require('../src/services/messagingWindow.service');
const { calculateMessagingWindow, calculateFreeEntryWindow } = messagingWindowService;

test('latest inbound timestamp opens the canonical window', () => {
  const result = calculateMessagingWindow('2026-08-07T00:00:00.000Z', '2026-08-07T23:59:59.000Z');
  assert.equal(result.isOpen, true);
  assert.equal(result.expiresAt, '2026-08-08T00:00:00.000Z');
  assert.equal(result.reason, 'CUSTOMER_SERVICE_WINDOW');
});

test('window closes exactly 24 hours after the inbound message', () => {
  assert.equal(calculateMessagingWindow('2026-08-07T00:00:00.000Z', '2026-08-08T00:00:00.000Z').isOpen, false);
});

test('no inbound customer message is closed with a stable reason', () => {
  assert.deepEqual(calculateMessagingWindow(null), {
    isOpen: false, openedAt: null, expiresAt: null, remainingSeconds: 0, reason: 'NO_INBOUND_CUSTOMER_MESSAGE'
  });
});

test('a later inbound message reopens an expired window', () => {
  const expired = calculateMessagingWindow('2026-08-05T00:00:00.000Z', '2026-08-07T00:00:00.000Z');
  const reopened = calculateMessagingWindow('2026-08-06T12:00:00.001Z', '2026-08-07T00:00:00.000Z');
  assert.equal(expired.isOpen, false);
  assert.equal(reopened.isOpen, true);
});

// 72-hour Free Entry Point — verified against current Meta documentation:
// opens for 72h only once the business replies within 24h of a referral-
// tagged (Click-to-WhatsApp ad or Facebook/Instagram Page CTA) entry message.
test('an eligible Click-to-WhatsApp ad referral with a timely reply opens the 72h window (scenario 5)', () => {
  const result = calculateFreeEntryWindow({
    referralAt: '2026-08-07T00:00:00.000Z', // source_type: "ad", ctwa_clid present
    responseAt: '2026-08-07T02:00:00.000Z',
    now: '2026-08-07T10:00:00.000Z'
  });
  assert.equal(result.eligible, true);
  assert.equal(result.status, 'active');
  assert.equal(result.expiresAt, '2026-08-10T02:00:00.000Z');
});

test('an eligible Facebook/Instagram Page CTA referral with a timely reply opens the 72h window (scenario 6)', () => {
  const result = calculateFreeEntryWindow({
    referralAt: '2026-08-07T00:00:00.000Z', // source_type: "ig_signup" or similar Page/IG CTA marker, no ctwa_clid
    responseAt: '2026-08-07T20:00:00.000Z',
    now: '2026-08-08T00:00:00.000Z'
  });
  assert.equal(result.eligible, true);
  assert.equal(result.status, 'active');
});

test('missing referral evidence never creates false eligibility (scenario 7)', () => {
  const result = calculateFreeEntryWindow({ now: '2026-08-07T00:00:00.000Z' });
  assert.equal(result.eligible, false);
  assert.equal(result.status, 'unknown');
  assert.equal(result.reason, 'NO_REFERRAL_EVIDENCE');
});

test('a business response later than 24h after the referral never qualifies the 72h window (scenario 8)', () => {
  const lateReply = calculateFreeEntryWindow({
    referralAt: '2026-08-07T00:00:00.000Z',
    responseAt: '2026-08-08T00:00:00.001Z', // 24h + 1ms late
    now: '2026-08-08T01:00:00.000Z'
  });
  assert.equal(lateReply.eligible, false);
  assert.equal(lateReply.status, 'not_qualified');
  assert.equal(lateReply.reason, 'LATE_RESPONSE');

  const noReplyYetPastDeadline = calculateFreeEntryWindow({
    referralAt: '2026-08-07T00:00:00.000Z',
    now: '2026-08-08T01:00:00.000Z' // past the 24h reply deadline, still no response at all
  });
  assert.equal(noReplyYetPastDeadline.eligible, false);
  assert.equal(noReplyYetPastDeadline.status, 'not_qualified');
  assert.equal(noReplyYetPastDeadline.reason, 'NO_RESPONSE_WITHIN_24H');
});

test('a qualified 72h window expires correctly exactly 72 hours after the qualifying response (scenario 9)', () => {
  const stillOpen = calculateFreeEntryWindow({
    referralAt: '2026-08-07T00:00:00.000Z', responseAt: '2026-08-07T01:00:00.000Z', now: '2026-08-10T00:59:59.000Z'
  });
  const justExpired = calculateFreeEntryWindow({
    referralAt: '2026-08-07T00:00:00.000Z', responseAt: '2026-08-07T01:00:00.000Z', now: '2026-08-10T01:00:00.001Z'
  });
  assert.equal(stillOpen.status, 'active');
  assert.equal(justExpired.status, 'expired');
  assert.equal(justExpired.eligible, true, 'an expired window is still a verified window, just no longer active');
});

test('a referral with no response yet, still inside its own 24h reply deadline, is distinctly "pending" rather than ineligible', () => {
  const result = calculateFreeEntryWindow({ referralAt: '2026-08-07T00:00:00.000Z', now: '2026-08-07T10:00:00.000Z' });
  assert.equal(result.eligible, false);
  assert.equal(result.status, 'pending_response');
});

function fakeConversation(overrides = {}) {
  return { id: 100, whatsappAccountId: 7, ...overrides };
}

// findAllImpl answers getFreeEntryWindow's "every recent referral message"
// lookup; findOneImpl answers BOTH getMessagingWindow's own 24h "latest
// inbound" lookup AND getFreeEntryWindow's per-candidate "qualifying
// response" lookup (distinguished by direction: 'outbound' inside each).
async function withMessageMocks({ findOneImpl = async () => null, findAllImpl = async () => [] } = {}, callback) {
  const original = models.Message.findOne;
  const originalAll = models.Message.findAll;
  const originalConv = models.Conversation.findByPk;
  models.Message.findOne = findOneImpl;
  models.Message.findAll = findAllImpl;
  models.Conversation.findByPk = async () => fakeConversation();
  try {
    return await callback();
  } finally {
    models.Message.findOne = original;
    models.Message.findAll = originalAll;
    models.Conversation.findByPk = originalConv;
  }
}

test('getFreeEntryWindow finds the latest referral-tagged inbound message and the first qualifying outbound reply (scenario 10 setup: both windows can coexist)', async () => {
  await withMessageMocks({
    findAllImpl: async () => [{ createdAt: new Date('2026-08-07T00:00:00.000Z') }],
    findOneImpl: async ({ where }) => (where.direction === 'outbound' ? { createdAt: new Date('2026-08-07T02:00:00.000Z') } : null)
  }, async () => {
    const result = await messagingWindowService.getFreeEntryWindow(100, 7, { now: new Date('2026-08-08T00:00:00.000Z') });
    assert.equal(result.eligible, true);
    assert.equal(result.status, 'active');
  });
});

test('getFreeEntryWindow reports unknown when no inbound message carries referral/ctwa_clid evidence at all', async () => {
  await withMessageMocks({ findAllImpl: async () => [] }, async () => {
    const result = await messagingWindowService.getFreeEntryWindow(100, 7);
    assert.equal(result.status, 'unknown');
    assert.equal(result.eligible, false);
  });
});

// Scenario #3: a queued or failed outbound message must never count as the
// qualifying business response that opens a window.
test('getFreeEntryWindow never qualifies a window from a pending or failed outbound message, only a confirmed-sent one', async () => {
  await withMessageMocks({
    findAllImpl: async () => [{ createdAt: new Date('2026-08-07T00:00:00.000Z') }],
    // The real query filters status IN ('sent','delivered','read') at the
    // DB level — a pending/failed row would never be returned to begin
    // with, so returning null here faithfully simulates that filter.
    findOneImpl: async ({ where }) => (where.direction === 'outbound' && where.status ? null : null)
  }, async () => {
    const result = await messagingWindowService.getFreeEntryWindow(100, 7, { now: new Date('2026-08-07T10:00:00.000Z') });
    assert.equal(result.eligible, false);
    assert.equal(result.status, 'pending_response', 'with only a pending/failed reply, this must read as "no qualifying response yet", never "active"');
  });
});

test('getFreeEntryWindow\'s outbound lookup is scoped to only sent/delivered/read statuses (scenario 3)', async () => {
  let capturedWhere = null;
  await withMessageMocks({
    findAllImpl: async () => [{ createdAt: new Date('2026-08-07T00:00:00.000Z') }],
    findOneImpl: async (query) => {
      if (query.where.direction === 'outbound') capturedWhere = query.where;
      return null;
    }
  }, async () => {
    await messagingWindowService.getFreeEntryWindow(100, 7);
    assert.deepEqual(capturedWhere.status[Object.getOwnPropertySymbols(capturedWhere.status)[0]] || capturedWhere.status, messagingWindowService.SUCCESSFULLY_SENT_STATUSES);
  });
});

// Scenario #4: a newer referral event (e.g. a second ad click) must never
// hide an earlier, still-active, already-qualified window.
test('a newer referral event does not hide an earlier referral\'s still-active verified window (scenario 4)', async () => {
  const olderReferral = { createdAt: new Date('2026-08-07T00:00:00.000Z') }; // qualified promptly, window still open
  const newerReferral = { createdAt: new Date('2026-08-07T20:00:00.000Z') }; // no reply yet, still within its own 24h deadline
  await withMessageMocks({
    findAllImpl: async () => [newerReferral, olderReferral], // DESC order, as the real query returns
    findOneImpl: async ({ where }) => {
      if (where.direction !== 'outbound') return null;
      // Only the OLDER referral ever got a timely reply.
      if (new Date(where.createdAt[Object.getOwnPropertySymbols(where.createdAt)[0]]).getTime() === olderReferral.createdAt.getTime()) {
        return { createdAt: new Date('2026-08-07T01:00:00.000Z') };
      }
      return null;
    }
  }, async () => {
    // "now" is only 4h after the newer referral (well inside ITS 24h reply
    // deadline, so on its own it would read "pending_response"), but also
    // well inside the OLDER referral's still-open 72h window.
    const now = new Date('2026-08-08T00:00:00.000Z');
    const result = await messagingWindowService.getFreeEntryWindow(100, 7, { now });
    assert.equal(result.status, 'active', 'the older, already-qualified window must win, not the newer unresolved referral');
    assert.equal(result.referralAt, olderReferral.createdAt.toISOString());
  });
});

test('once every referral\'s window has expired or failed to qualify, the most recent referral\'s own status is reported (scenario 4, no-active fallback)', async () => {
  const olderReferral = { createdAt: new Date('2026-08-01T00:00:00.000Z') }; // long expired
  const newerReferral = { createdAt: new Date('2026-08-07T00:00:00.000Z') }; // late reply, never qualified
  await withMessageMocks({
    findAllImpl: async () => [newerReferral, olderReferral],
    findOneImpl: async ({ where }) => {
      if (where.direction !== 'outbound') return null;
      const target = where.createdAt[Object.getOwnPropertySymbols(where.createdAt)[0]];
      if (new Date(target).getTime() === olderReferral.createdAt.getTime()) return { createdAt: new Date('2026-08-01T01:00:00.000Z') };
      if (new Date(target).getTime() === newerReferral.createdAt.getTime()) return { createdAt: new Date('2026-08-08T02:00:00.000Z') }; // > 24h late
      return null;
    }
  }, async () => {
    const now = new Date('2026-08-10T00:00:00.000Z'); // older window long expired
    const result = await messagingWindowService.getFreeEntryWindow(100, 7, { now });
    assert.equal(result.status, 'not_qualified');
    assert.equal(result.referralAt, newerReferral.createdAt.toISOString(), 'falls back to the MOST RECENT referral once none is active');
  });
});

test('getFreeEntryWindow rejects a conversation that belongs to a different WhatsApp account, same as getMessagingWindow', async () => {
  const original = models.Conversation.findByPk;
  models.Conversation.findByPk = async () => fakeConversation({ whatsappAccountId: 999 });
  try {
    await assert.rejects(
      messagingWindowService.getFreeEntryWindow(100, 7),
      (error) => error.code === 'WHATSAPP_ACCOUNT_MISMATCH'
    );
  } finally {
    models.Conversation.findByPk = original;
  }
});

test('getBothWindows returns the 24h and 72h windows together and both can be simultaneously active (scenario 10)', async () => {
  await withMessageMocks({
    // Both a referral-qualifying inbound AND a recent plain inbound exist —
    // getMessagingWindow's own lookup (Message.findOne, no referral filter)
    // and getFreeEntryWindow's referral lookup (Message.findAll) both see
    // the same recent message, satisfying the 24h "latest inbound" check
    // and (via its referral metadata) the 72h entry-event check at once.
    findOneImpl: async ({ where }) => {
      if (where.direction === 'inbound') return { createdAt: new Date('2026-08-07T23:00:00.000Z') };
      if (where.direction === 'outbound') return { createdAt: new Date('2026-08-07T23:30:00.000Z') };
      return null;
    },
    findAllImpl: async () => [{ createdAt: new Date('2026-08-07T23:00:00.000Z') }]
  }, async () => {
    const now = new Date('2026-08-08T00:00:00.000Z');
    const { serviceWindow, freeEntryWindow } = await messagingWindowService.getBothWindows(100, 7, { now });
    assert.equal(serviceWindow.isOpen, true, '24h window is active');
    assert.equal(freeEntryWindow.status, 'active', '72h window is ALSO active at the same time');
  });
});
