const test = require('node:test');
const assert = require('node:assert/strict');
const { FacebookCommentAutoHideRule } = require('../src/models');
const facebookPageAccessService = require('../src/services/facebookPageAccess.service');
const ruleService = require('../src/services/facebookCommentAutoHideRule.service');
const { evaluateRule, MATCH_TYPES } = ruleService;

const originals = {
  findAll: FacebookCommentAutoHideRule.findAll,
  findByPk: FacebookCommentAutoHideRule.findByPk,
  create: FacebookCommentAutoHideRule.create,
  assertAccess: facebookPageAccessService.assertAccess,
  userContext: facebookPageAccessService.userContext
};

test.afterEach(() => {
  FacebookCommentAutoHideRule.findAll = originals.findAll;
  FacebookCommentAutoHideRule.findByPk = originals.findByPk;
  FacebookCommentAutoHideRule.create = originals.create;
  facebookPageAccessService.assertAccess = originals.assertAccess;
  facebookPageAccessService.userContext = originals.userContext;
});

// --- 1-6: match type + case sensitivity -------------------------------------

test('contains match', () => {
  assert.equal(evaluateRule('This is a scam alert', { keyword: 'scam', matchType: 'contains', caseSensitive: false }), true);
  assert.equal(evaluateRule('This is fine', { keyword: 'scam', matchType: 'contains', caseSensitive: false }), false);
});

test('exact match', () => {
  assert.equal(evaluateRule('scam', { keyword: 'scam', matchType: 'exact', caseSensitive: false }), true);
  assert.equal(evaluateRule('this is a scam', { keyword: 'scam', matchType: 'exact', caseSensitive: false }), false);
});

test('starts_with match', () => {
  assert.equal(evaluateRule('scam company', { keyword: 'scam', matchType: 'starts_with', caseSensitive: false }), true);
  assert.equal(evaluateRule('this is a scam', { keyword: 'scam', matchType: 'starts_with', caseSensitive: false }), false);
});

test('ends_with match', () => {
  assert.equal(evaluateRule('this is a scam', { keyword: 'scam', matchType: 'ends_with', caseSensitive: false }), true);
  assert.equal(evaluateRule('scam company', { keyword: 'scam', matchType: 'ends_with', caseSensitive: false }), false);
});

test('case-insensitive matching (default) matches regardless of casing', () => {
  assert.equal(evaluateRule('This is a SCAM', { keyword: 'scam', matchType: 'contains', caseSensitive: false }), true);
  assert.equal(evaluateRule('scam company', { keyword: 'scam', matchType: 'contains', caseSensitive: false }), true);
});

test('case-sensitive matching only matches exact casing', () => {
  assert.equal(evaluateRule('This is a SCAM', { keyword: 'scam', matchType: 'contains', caseSensitive: true }), false);
  assert.equal(evaluateRule('this is a scam', { keyword: 'scam', matchType: 'contains', caseSensitive: true }), true);
});

test('MATCH_TYPES exposes exactly the four supported, non-regex modes', () => {
  assert.deepEqual(MATCH_TYPES, ['contains', 'exact', 'starts_with', 'ends_with']);
});

test('evaluateRule never throws on malformed rule/comment values (matching safety)', () => {
  assert.doesNotThrow(() => evaluateRule('hello', { keyword: null, matchType: 'contains', caseSensitive: false }));
  assert.doesNotThrow(() => evaluateRule(null, { keyword: 'scam', matchType: 'exact', caseSensitive: false }));
  assert.doesNotThrow(() => evaluateRule('hello', { keyword: 'scam', matchType: 'not_a_real_type', caseSensitive: false }));
  assert.equal(evaluateRule('hello', { keyword: '', matchType: 'contains', caseSensitive: false }), false);
});

// --- 18: blank keyword rejected ----------------------------------------------

test('blank keyword is rejected', async () => {
  await assert.rejects(ruleService.createRule({ keyword: '   ' }, null), /Keyword is required/);
});

test('keyword input is trimmed before saving', async () => {
  FacebookCommentAutoHideRule.findAll = async () => [];
  let created = null;
  FacebookCommentAutoHideRule.create = async (data) => { created = { id: 1, ...data }; return created; };
  await ruleService.createRule({ keyword: '  scam  ' }, null);
  assert.equal(created.keyword, 'scam');
});

test('an unsupported matchType is rejected rather than silently accepted', async () => {
  await assert.rejects(ruleService.createRule({ keyword: 'scam', matchType: 'regex' }, null), /matchType must be one of/);
});

test('a duplicate rule (same keyword/matchType/caseSensitive/Page) is rejected', async () => {
  FacebookCommentAutoHideRule.findAll = async () => [
    { id: 1, keyword: 'scam', matchType: 'contains', caseSensitive: false, facebookPageId: null }
  ];
  await assert.rejects(ruleService.createRule({ keyword: 'SCAM' }, null), /already exists/);
});

test('the same keyword is allowed again when scoped to a different Page', async () => {
  const seen = [];
  FacebookCommentAutoHideRule.findAll = async (opts) => {
    seen.push(opts.where.facebookPageId);
    return []; // no existing rule for this specific page scope
  };
  let created = null;
  FacebookCommentAutoHideRule.create = async (data) => { created = { id: 2, ...data }; return created; };
  facebookPageAccessService.assertAccess = async () => true;
  await ruleService.createRule({ keyword: 'scam', facebookPageId: 55 }, 1);
  assert.equal(created.facebookPageId, 55);
});

// --- 17: unauthorized user cannot manage another Page's rules ---------------

test('a restricted user cannot create a rule for a Page they do not have access to', async () => {
  facebookPageAccessService.assertAccess = async () => { throw Object.assign(new Error('You do not have access to this Facebook Page'), { status: 403 }); };
  await assert.rejects(ruleService.createRule({ keyword: 'scam', facebookPageId: 55 }, 42), /do not have access/);
});

test('a restricted user cannot create a global (all-Pages) rule', async () => {
  facebookPageAccessService.userContext = async () => ({ unrestricted: false, pageIds: ['10'] });
  await assert.rejects(ruleService.createRule({ keyword: 'scam' }, 42), /unrestricted Facebook Page access/);
});

test('an unrestricted (admin) user can create a global rule', async () => {
  facebookPageAccessService.userContext = async () => ({ unrestricted: true, pageIds: [] });
  FacebookCommentAutoHideRule.findAll = async () => [];
  let created = null;
  FacebookCommentAutoHideRule.create = async (data) => { created = { id: 3, ...data }; return created; };
  await ruleService.createRule({ keyword: 'scam' }, 1);
  assert.equal(created.facebookPageId, null);
});

test('a restricted user cannot edit or delete a rule scoped to a Page they cannot access', async () => {
  const rule = { id: 9, facebookPageId: 77, keyword: 'x', destroy: async () => { throw new Error('must not be called'); }, update: async () => { throw new Error('must not be called'); } };
  FacebookCommentAutoHideRule.findByPk = async () => rule;
  facebookPageAccessService.userContext = async () => ({ unrestricted: false, pageIds: ['10'] });
  await assert.rejects(ruleService.updateRule(9, { keyword: 'y' }, 42), /do not have access/);
  await assert.rejects(ruleService.deleteRule(9, 42), /do not have access/);
});

test('a restricted user CAN manage a rule scoped to a Page they do have access to', async () => {
  const rule = { id: 11, facebookPageId: 10, keyword: 'x', matchType: 'contains', caseSensitive: false, update: async function (values) { Object.assign(this, values); } };
  FacebookCommentAutoHideRule.findByPk = async () => rule;
  FacebookCommentAutoHideRule.findAll = async () => [];
  facebookPageAccessService.userContext = async () => ({ unrestricted: false, pageIds: ['10'] });
  await ruleService.updateRule(11, { keyword: 'y' }, 42);
  assert.equal(rule.keyword, 'y');
});
