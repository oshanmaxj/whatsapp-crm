const test = require('node:test');
const assert = require('node:assert/strict');

const { matchesTrigger, SOURCES } = require('../src/services/flowTriggerMatcher.service');

test('the new Facebook trigger sources are registered', () => {
  for (const source of ['facebook_message_received', 'facebook_comment_received', 'facebook_comment_keyword']) {
    assert.ok(SOURCES.has(source), `expected ${source} to be a registered trigger source`);
  }
});

test('a WhatsApp-only flow with an unscoped "any message" trigger never fires for a Facebook event', () => {
  const whatsappFlow = { whatsappAccountId: null, facebookPageId: null, channel: 'whatsapp', triggerConfig: { source: 'any_message' }, triggerKeywords: [] };
  const facebookMessageEvent = { channel: 'facebook_messenger', text: 'hello from messenger', facebookPageId: 9 };
  assert.equal(matchesTrigger(whatsappFlow, facebookMessageEvent), false);
});

test('an unscoped Facebook message flow matches an inbound Messenger event but not a WhatsApp one', () => {
  const facebookFlow = { whatsappAccountId: null, facebookPageId: null, channel: 'facebook_messenger', triggerConfig: { source: 'facebook_message_received' }, triggerKeywords: [] };
  assert.equal(matchesTrigger(facebookFlow, { channel: 'facebook_messenger', text: 'hi' }), true);
  assert.equal(matchesTrigger(facebookFlow, { channel: 'whatsapp', text: 'hi' }), false);
});

test('a Page-scoped Facebook flow only matches events from that Page', () => {
  const scopedFlow = { whatsappAccountId: null, facebookPageId: 42, channel: 'facebook_messenger', triggerConfig: { source: 'facebook_message_received' }, triggerKeywords: [] };
  assert.equal(matchesTrigger(scopedFlow, { channel: 'facebook_messenger', text: 'hi', facebookPageId: 42 }), true);
  assert.equal(matchesTrigger(scopedFlow, { channel: 'facebook_messenger', text: 'hi', facebookPageId: 99 }), false);
});

test('facebook_comment_received and facebook_comment_keyword only match comment-channel events', () => {
  const commentFlow = { whatsappAccountId: null, facebookPageId: null, channel: 'facebook_comment', triggerConfig: { source: 'facebook_comment_received' }, triggerKeywords: [] };
  assert.equal(matchesTrigger(commentFlow, { channel: 'facebook_comment', text: 'great post' }), true);
  assert.equal(matchesTrigger(commentFlow, { channel: 'facebook_messenger', text: 'great post' }), false);
});

test('facebook_comment_keyword still applies the flow\'s configured keyword filter', () => {
  const keywordFlow = {
    whatsappAccountId: null, facebookPageId: null, channel: 'facebook_comment',
    triggerConfig: { source: 'facebook_comment_keyword', keywords: ['price', 'cost'], matchType: 'contains' },
    triggerKeywords: []
  };
  assert.equal(matchesTrigger(keywordFlow, { channel: 'facebook_comment', text: 'what is the price?' }), true);
  assert.equal(matchesTrigger(keywordFlow, { channel: 'facebook_comment', text: 'nice photo!' }), false);
});

test('an existing WhatsApp keyword flow is unaffected by the new Facebook branches', () => {
  const whatsappFlow = { whatsappAccountId: 3, facebookPageId: null, channel: 'whatsapp', triggerConfig: { source: 'inbound_message', keywords: ['hello'] }, triggerKeywords: [] };
  assert.equal(matchesTrigger(whatsappFlow, { channel: 'whatsapp', whatsappAccountId: 3, text: 'hello there' }), true);
  assert.equal(matchesTrigger(whatsappFlow, { channel: 'whatsapp', whatsappAccountId: 5, text: 'hello there' }), false);
});
