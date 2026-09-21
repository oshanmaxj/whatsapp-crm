const test = require('node:test');
const assert = require('node:assert/strict');
const { Op } = require('sequelize');
const { FacebookCommentAutoHideRule, AppSetting } = require('../src/models');
const facebookCommentService = require('../src/services/facebookComment.service');
const facebookPageService = require('../src/services/facebookPage.service');
const ruleService = require('../src/services/facebookCommentAutoHideRule.service');

const originals = {
  ruleFindAll: FacebookCommentAutoHideRule.findAll,
  settingsFindOrCreate: AppSetting.findOrCreate,
  setHiddenState: facebookCommentService.setHiddenState,
  commentGet: facebookCommentService.get,
  runtimeConfig: facebookPageService.runtimeConfig,
  graphRequest: facebookPageService.graphRequest
};

test.afterEach(() => {
  FacebookCommentAutoHideRule.findAll = originals.ruleFindAll;
  AppSetting.findOrCreate = originals.settingsFindOrCreate;
  facebookCommentService.setHiddenState = originals.setHiddenState;
  facebookCommentService.get = originals.commentGet;
  facebookPageService.runtimeConfig = originals.runtimeConfig;
  facebookPageService.graphRequest = originals.graphRequest;
});

function commentRow(overrides = {}) {
  const row = {
    id: 1, facebookPageId: 10, metaCommentId: 'cmt_1', message: 'This is a scam',
    hidden: false, autoHideMatched: false, autoHideStatus: 'not_matched',
    autoHideRuleId: null, autoHideKeyword: null, autoHideMatchType: null,
    autoHiddenAt: null, autoHideError: null, autoHideAttemptedAt: null,
    ...overrides
  };
  row.update = async (values) => { Object.assign(row, values); return row; };
  return row;
}

function settingsRow(enabled) {
  const row = { id: 1, value: { enabled } };
  row.update = async (values) => { Object.assign(row, values); return row; };
  return row;
}

// Faithfully replicates the WHERE shape evaluateAndHide() builds:
// { enabled: true, [Op.or]: [{facebookPageId:null},{facebookPageId: X}] }
function mockRuleQuery(allRules) {
  return async (opts) => {
    const where = opts.where || {};
    return allRules.filter((rule) => {
      if (where.enabled !== undefined && Boolean(rule.enabled) !== where.enabled) return false;
      const orClause = where[Op.or];
      if (!orClause) return true;
      return orClause.some((cond) => (cond.facebookPageId === null ? rule.facebookPageId === null : rule.facebookPageId === cond.facebookPageId));
    });
  };
}

// --- 8: global auto-hide OFF does not hide -----------------------------------

test('global auto-hide OFF does not hide even when a rule would otherwise match', async () => {
  AppSetting.findOrCreate = async () => [settingsRow(false)];
  FacebookCommentAutoHideRule.findAll = async () => { throw new Error('rules must not be queried while globally disabled'); };
  let hideCalls = 0;
  facebookCommentService.setHiddenState = async () => { hideCalls += 1; };

  const comment = commentRow();
  await ruleService.evaluateAndHide(comment);
  assert.equal(hideCalls, 0);
  assert.equal(comment.autoHideStatus, 'not_matched');
});

// --- 9/10: page-specific vs. global rule scoping -----------------------------

test('a page-specific rule only applies to its own Page', async () => {
  AppSetting.findOrCreate = async () => [settingsRow(true)];
  const rules = [{ id: 5, keyword: 'scam', matchType: 'contains', caseSensitive: false, enabled: true, facebookPageId: 99 }];
  FacebookCommentAutoHideRule.findAll = mockRuleQuery(rules);
  let hideCalls = 0;
  facebookCommentService.setHiddenState = async (comment) => { hideCalls += 1; comment.hidden = true; };

  const otherPageComment = commentRow({ facebookPageId: 10, message: 'this is a scam' });
  await ruleService.evaluateAndHide(otherPageComment);
  assert.equal(hideCalls, 0);
  assert.equal(otherPageComment.autoHideStatus, 'not_matched');

  const matchingPageComment = commentRow({ id: 2, facebookPageId: 99, message: 'this is a scam' });
  await ruleService.evaluateAndHide(matchingPageComment);
  assert.equal(hideCalls, 1);
  assert.equal(matchingPageComment.autoHideStatus, 'hidden');
});

test('a global rule (facebookPageId null) applies to every Page', async () => {
  AppSetting.findOrCreate = async () => [settingsRow(true)];
  const rules = [{ id: 6, keyword: 'fraud', matchType: 'contains', caseSensitive: false, enabled: true, facebookPageId: null }];
  FacebookCommentAutoHideRule.findAll = mockRuleQuery(rules);
  facebookCommentService.setHiddenState = async (comment) => { comment.hidden = true; };

  const pageA = commentRow({ id: 1, facebookPageId: 10, message: 'total fraud' });
  const pageB = commentRow({ id: 2, facebookPageId: 20, message: 'total fraud' });
  await ruleService.evaluateAndHide(pageA);
  await ruleService.evaluateAndHide(pageB);
  assert.equal(pageA.autoHideStatus, 'hidden');
  assert.equal(pageB.autoHideStatus, 'hidden');
});

// --- 7: disabled rule does not match ------------------------------------------

test('a disabled rule never matches, even with identical keyword text', async () => {
  AppSetting.findOrCreate = async () => [settingsRow(true)];
  const rules = [{ id: 1, keyword: 'scam', matchType: 'contains', caseSensitive: false, enabled: false, facebookPageId: null }];
  FacebookCommentAutoHideRule.findAll = mockRuleQuery(rules);
  let hideCalls = 0;
  facebookCommentService.setHiddenState = async () => { hideCalls += 1; };

  const comment = commentRow({ message: 'this is a scam' });
  await ruleService.evaluateAndHide(comment);
  assert.equal(hideCalls, 0);
  assert.equal(comment.autoHideStatus, 'not_matched');
});

// --- 11/12: exactly-once hide + idempotency on redelivery --------------------

test('a successful match calls the Graph hide exactly once', async () => {
  AppSetting.findOrCreate = async () => [settingsRow(true)];
  const rules = [{ id: 7, keyword: 'fraud', matchType: 'contains', caseSensitive: false, enabled: true, facebookPageId: null }];
  FacebookCommentAutoHideRule.findAll = mockRuleQuery(rules);
  let hideCalls = 0;
  facebookCommentService.setHiddenState = async (comment) => { hideCalls += 1; comment.hidden = true; };

  const comment = commentRow({ message: 'total fraud here' });
  await ruleService.evaluateAndHide(comment);
  assert.equal(hideCalls, 1);
  assert.equal(comment.autoHideStatus, 'hidden');
  assert.equal(comment.autoHideRuleId, 7);
  assert.equal(comment.autoHideKeyword, 'fraud');
  assert.equal(comment.autoHideMatchType, 'contains');
});

test('re-processing the same already-hidden comment (Meta webhook redelivery) never calls Graph hide again', async () => {
  AppSetting.findOrCreate = async () => [settingsRow(true)];
  const rules = [{ id: 7, keyword: 'fraud', matchType: 'contains', caseSensitive: false, enabled: true, facebookPageId: null }];
  FacebookCommentAutoHideRule.findAll = mockRuleQuery(rules);
  let hideCalls = 0;
  facebookCommentService.setHiddenState = async (comment) => { hideCalls += 1; comment.hidden = true; };

  const comment = commentRow({ message: 'total fraud here' });
  await ruleService.evaluateAndHide(comment);
  assert.equal(hideCalls, 1);

  // Simulate Facebook redelivering the same webhook event for the same comment.
  await ruleService.evaluateAndHide(comment);
  assert.equal(hideCalls, 1, 'must not call Graph hide a second time once already hidden');
});

// --- 13/14: Meta failure never fails the caller; failure status is stored ---

test('a Meta Graph failure during evaluateAndHide never throws, and stores a failed status', async () => {
  AppSetting.findOrCreate = async () => [settingsRow(true)];
  const rules = [{ id: 3, keyword: 'fake', matchType: 'contains', caseSensitive: false, enabled: true, facebookPageId: null }];
  FacebookCommentAutoHideRule.findAll = mockRuleQuery(rules);
  facebookCommentService.setHiddenState = async () => { throw Object.assign(new Error('Meta rate limited'), { exposeMessage: true }); };

  const comment = commentRow({ message: 'fake product' });
  await assert.doesNotReject(ruleService.evaluateAndHide(comment));
  assert.equal(comment.autoHideStatus, 'failed');
  assert.equal(comment.autoHideError, 'Meta rate limited');
  assert.equal(comment.hidden, false);
});

test('a non-exposeMessage Graph error is sanitized before being stored (no raw Meta/error internals leaked)', async () => {
  AppSetting.findOrCreate = async () => [settingsRow(true)];
  const rules = [{ id: 3, keyword: 'fake', matchType: 'contains', caseSensitive: false, enabled: true, facebookPageId: null }];
  FacebookCommentAutoHideRule.findAll = mockRuleQuery(rules);
  facebookCommentService.setHiddenState = async () => { throw new Error('ECONNRESET internal socket detail'); };

  const comment = commentRow({ message: 'fake product' });
  await ruleService.evaluateAndHide(comment);
  assert.equal(comment.autoHideStatus, 'failed');
  assert.equal(comment.autoHideError, 'Failed to hide this comment via the Meta Graph API.');
});

// --- one bad rule must not crash evaluation of the others --------------------

test('one rule throwing during evaluation is logged and skipped; remaining rules still evaluate', async () => {
  AppSetting.findOrCreate = async () => [settingsRow(true)];
  const badRule = { id: 1, matchType: 'contains', caseSensitive: false, enabled: true, facebookPageId: null };
  Object.defineProperty(badRule, 'keyword', { get() { throw new Error('boom'); } });
  const goodRule = { id: 2, keyword: 'scam', matchType: 'contains', caseSensitive: false, enabled: true, facebookPageId: null };
  FacebookCommentAutoHideRule.findAll = mockRuleQuery([badRule, goodRule]);
  facebookCommentService.setHiddenState = async (comment) => { comment.hidden = true; };

  const comment = commentRow({ message: 'this is a scam' });
  await assert.doesNotReject(ruleService.evaluateAndHide(comment));
  assert.equal(comment.autoHideStatus, 'hidden');
  assert.equal(comment.autoHideRuleId, 2);
});

// --- 15: manual retry works ---------------------------------------------------

test('retryAutoHide re-attempts a failed hide and succeeds', async () => {
  const comment = commentRow({ autoHideStatus: 'failed', autoHideError: 'previous failure', autoHideMatched: true, autoHideRuleId: 3, autoHideKeyword: 'fake' });
  facebookCommentService.get = async () => comment;
  facebookCommentService.setHiddenState = async (c) => { c.hidden = true; };
  const result = await ruleService.retryAutoHide(comment.id, 1);
  assert.equal(result.autoHideStatus, 'hidden');
  assert.equal(result.autoHideError, null);
});

test('retryAutoHide refuses to retry a comment that never had a failed auto-hide attempt', async () => {
  const comment = commentRow({ autoHideStatus: 'not_matched' });
  facebookCommentService.get = async () => comment;
  await assert.rejects(ruleService.retryAutoHide(comment.id, 1), /does not have a failed auto-hide attempt/);
});

test('retryAutoHide on an already-hidden comment is idempotent and does not call Graph again', async () => {
  const comment = commentRow({ autoHideStatus: 'hidden', hidden: true });
  facebookCommentService.get = async () => comment;
  let hideCalls = 0;
  facebookCommentService.setHiddenState = async () => { hideCalls += 1; };
  const result = await ruleService.retryAutoHide(comment.id, 1);
  assert.equal(hideCalls, 0);
  assert.equal(result.autoHideStatus, 'hidden');
});

test('retryAutoHide rethrows (rather than swallowing) a repeated Graph failure, for the admin-facing request to surface it', async () => {
  const comment = commentRow({ autoHideStatus: 'failed', autoHideError: 'previous failure' });
  facebookCommentService.get = async () => comment;
  facebookCommentService.setHiddenState = async () => { throw Object.assign(new Error('still failing'), { exposeMessage: true }); };
  await assert.rejects(ruleService.retryAutoHide(comment.id, 1), /still failing/);
  assert.equal(comment.autoHideStatus, 'failed');
});

// --- 16: manual hide/unhide uses the shared Graph service, not a duplicate ---

test('manual hideComment and unhideComment both call the single shared Graph request helper', async () => {
  const comment = commentRow({ hidden: false });
  facebookCommentService.get = async () => comment;
  facebookPageService.runtimeConfig = async () => ({ pageAccessToken: 'tok', facebookPageId: comment.facebookPageId });
  const graphCalls = [];
  facebookPageService.graphRequest = async (config, method, objectId, edge, params) => {
    graphCalls.push({ method, objectId, params });
    return { data: {} };
  };

  await facebookCommentService.hideComment(comment.id, 1);
  assert.equal(graphCalls.length, 1);
  assert.equal(graphCalls[0].objectId, comment.metaCommentId);
  assert.equal(graphCalls[0].params.is_hidden, true);
  assert.equal(comment.hidden, true);

  await facebookCommentService.unhideComment(comment.id, 1);
  assert.equal(graphCalls.length, 2);
  assert.equal(graphCalls[1].params.is_hidden, false);
  assert.equal(comment.hidden, false);
});

test('hideComment on an already-hidden comment is idempotent and does not call Graph again', async () => {
  const comment = commentRow({ hidden: true });
  facebookCommentService.get = async () => comment;
  let calls = 0;
  facebookPageService.graphRequest = async () => { calls += 1; return { data: {} }; };
  await facebookCommentService.hideComment(comment.id, 1);
  assert.equal(calls, 0);
});

test('auto-hide and manual hide funnel through the exact same setHiddenState implementation (no duplicate Graph API code path)', () => {
  assert.equal(typeof facebookCommentService.setHiddenState, 'function');
  // Static-source guard: ensures no second ad-hoc axios/graph call for hiding
  // was introduced elsewhere instead of reusing setHiddenState.
  const fs = require('node:fs');
  const path = require('node:path');
  const ruleServiceSource = fs.readFileSync(path.join(__dirname, '..', 'src/services/facebookCommentAutoHideRule.service.js'), 'utf8');
  assert.match(ruleServiceSource, /facebookCommentService\.setHiddenState/);
  assert.doesNotMatch(ruleServiceSource, /is_hidden/, 'the rule service must not itself construct a Graph payload — it must delegate to facebookCommentService.setHiddenState');
});
