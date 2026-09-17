const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/models');
const flowService = require('../src/services/flow.service');
const flowActionService = require('../src/services/flowAction.service');
const facebookCommentService = require('../src/services/facebookComment.service');
const facebookMessengerService = require('../src/services/facebookMessenger.service');
const facebookConversationIdentityService = require('../src/services/facebookConversationIdentity.service');

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

function fakeRun(id, extra = {}) {
  const run = { id, ...extra, async update(patch) { Object.assign(run, patch); return run; } };
  return run;
}

// handleDomainEvent resolves event.contact/event.lead only when contactId is
// absent, but executeFlow unconditionally re-fetches by contactId regardless
// of whether a contact object was already passed on the event — so every
// handleDomainEvent test needs these mocked even when the event carries a
// contactId that "looks" already resolved.
function contactLeadMocks(contact = { id: 501, firstName: 'Sam' }, lead = null) {
  return {
    'Contact.findByPk': async () => contact,
    'Lead.findByPk': async () => lead
  };
}

function commentReplyFlow({ id = 1, source = 'facebook_comment_received', matchType, keywords = [] } = {}) {
  return {
    id, status: 'published', channel: 'facebook_comment', channels: null,
    whatsappAccountId: null, facebookPageId: 9, departmentId: null,
    triggerConfig: { source, ...(matchType ? { matchType } : {}) },
    triggerKeywords: keywords,
    nodes: [{ id: 1, nodeKey: 'n1', nodeType: 'facebook_comment_reply', label: 'Reply', configJson: { message: 'Thanks for your comment!' }, stats: {} }],
    connections: []
  };
}

function patchCommentReply(overrides = {}) {
  const original = facebookCommentService.replyToComment;
  const calls = [];
  facebookCommentService.replyToComment = async (commentId, payload, userId) => {
    calls.push({ commentId, payload, userId });
    return overrides.result || { id: commentId, replied: true };
  };
  patchCommentReply.calls = calls;
  return () => { facebookCommentService.replyToComment = original; };
}

test('scenario 10: an "any comment" flow (facebook_comment_received, no keywords) triggers on any new comment', async () => {
  const flowRunsCreated = [];
  const restore = patchModelMethods({
    ...contactLeadMocks(),
    'Flow.findAll': async () => [commentReplyFlow({ source: 'facebook_comment_received' })],
    'FlowRun.findOne': async () => null,
    'FlowRun.create': async (data) => { const run = fakeRun(flowRunsCreated.length + 1, data); flowRunsCreated.push(run); return run; },
    'FlowRunLog.create': async () => ({}),
    'FlowNode.update': async () => [1]
  });
  const commentServiceRestore = patchCommentReply();
  try {
    await flowService.handleDomainEvent({
      eventType: 'facebook_comment_received', eventId: 'c-any-1', channel: 'facebook_comment',
      facebookPageId: 9, contactId: 501, commentId: 77, text: 'nice product!'
    });
    assert.equal(flowRunsCreated.length, 1, 'the any-comment flow must have started exactly one run');
  } finally { commentServiceRestore(); restore(); }
});

test('scenario 11: an exact-keyword comment flow only matches an exact "price" comment, not a longer sentence containing it', async () => {
  const flowRunsCreated = [];
  const restore = patchModelMethods({
    ...contactLeadMocks(),
    'Flow.findAll': async () => [commentReplyFlow({ source: 'facebook_comment_keyword', matchType: 'exact', keywords: ['price'] })],
    'FlowRun.findOne': async () => null,
    'FlowRun.create': async (data) => { const run = fakeRun(flowRunsCreated.length + 1, data); flowRunsCreated.push(run); return run; },
    'FlowRunLog.create': async () => ({}),
    'FlowNode.update': async () => [1]
  });
  const commentServiceRestore = patchCommentReply();
  try {
    await flowService.handleDomainEvent({ eventType: 'facebook_comment_received', eventId: 'c-exact-miss', channel: 'facebook_comment', facebookPageId: 9, contactId: 501, commentId: 78, text: 'what is the price?' });
    assert.equal(flowRunsCreated.length, 0, 'a longer sentence must not match an exact-keyword trigger');

    await flowService.handleDomainEvent({ eventType: 'facebook_comment_received', eventId: 'c-exact-hit', channel: 'facebook_comment', facebookPageId: 9, contactId: 501, commentId: 79, text: 'price' });
    assert.equal(flowRunsCreated.length, 1, 'the exact word "price" must match');
  } finally { commentServiceRestore(); restore(); }
});

test('scenario 12: a contains-keyword comment flow matches "price" anywhere in the comment text', async () => {
  const flowRunsCreated = [];
  const restore = patchModelMethods({
    ...contactLeadMocks(),
    'Flow.findAll': async () => [commentReplyFlow({ source: 'facebook_comment_keyword', matchType: 'contains', keywords: ['price'] })],
    'FlowRun.findOne': async () => null,
    'FlowRun.create': async (data) => { const run = fakeRun(flowRunsCreated.length + 1, data); flowRunsCreated.push(run); return run; },
    'FlowRunLog.create': async () => ({}),
    'FlowNode.update': async () => [1]
  });
  const commentServiceRestore = patchCommentReply();
  try {
    await flowService.handleDomainEvent({ eventType: 'facebook_comment_received', eventId: 'c-contains-1', channel: 'facebook_comment', facebookPageId: 9, contactId: 501, commentId: 80, text: 'what is the price for this?' });
    assert.equal(flowRunsCreated.length, 1);
  } finally { commentServiceRestore(); restore(); }
});

test('a WhatsApp-only flow candidate never matches a comment event even if it were somehow returned by the query', async () => {
  const flowRunsCreated = [];
  const whatsappFlow = { id: 2, status: 'published', channel: 'whatsapp', channels: null, whatsappAccountId: 3, facebookPageId: null, triggerConfig: { source: 'inbound_message' }, triggerKeywords: [], nodes: [], connections: [] };
  const restore = patchModelMethods({
    ...contactLeadMocks(),
    'Flow.findAll': async () => [whatsappFlow],
    'FlowRun.findOne': async () => null,
    'FlowRun.create': async (data) => { const run = fakeRun(flowRunsCreated.length + 1, data); flowRunsCreated.push(run); return run; },
    'FlowRunLog.create': async () => ({}),
    'FlowNode.update': async () => [1]
  });
  try {
    await flowService.handleDomainEvent({ eventType: 'facebook_comment_received', eventId: 'c-guard', channel: 'facebook_comment', facebookPageId: 9, contactId: 501, commentId: 81, text: 'price' });
    assert.equal(flowRunsCreated.length, 0);
  } finally { restore(); }
});

// 13. Public comment reply action/node.
test('scenario 13: the facebook_comment_reply node calls facebookComment.service.replyToComment with the rendered message', async () => {
  const flowRunsCreated = [];
  const restore = patchModelMethods({
    ...contactLeadMocks(),
    'Flow.findAll': async () => [commentReplyFlow({ source: 'facebook_comment_received' })],
    'FlowRun.findOne': async () => null,
    'FlowRun.create': async (data) => { const run = fakeRun(flowRunsCreated.length + 1, data); flowRunsCreated.push(run); return run; },
    'FlowRunLog.create': async () => ({}),
    'FlowNode.update': async () => [1]
  });
  const restoreReply = patchCommentReply();
  try {
    await flowService.handleDomainEvent({ eventType: 'facebook_comment_received', eventId: 'c-reply', channel: 'facebook_comment', facebookPageId: 9, contactId: 501, commentId: 88, text: 'nice!' });
    assert.equal(patchCommentReply.calls.length, 1);
    assert.equal(patchCommentReply.calls[0].commentId, 88);
    assert.equal(patchCommentReply.calls[0].payload.message, 'Thanks for your comment!');
  } finally { restoreReply(); restore(); }
});

// 14. Private Messenger response from a comment, resolving the conversation
// on demand via facebookConversationIdentityService — never a duplicate
// identity/contact/conversation implementation.
test('scenario 14: a text_message node on a comment-triggered run resolves the Messenger conversation from psid, then sends through the Messenger adapter', async () => {
  const flowRunsCreated = [];
  const flow = commentReplyFlow({ source: 'facebook_comment_received' });
  flow.nodes = [{ id: 1, nodeKey: 'n1', nodeType: 'text_message', label: 'Private reply', configJson: { message: 'Details sent!' }, stats: {} }];
  const restore = patchModelMethods({
    ...contactLeadMocks(),
    'Flow.findAll': async () => [flow],
    'FlowRun.findOne': async () => null,
    'FlowRun.create': async (data) => { const run = fakeRun(flowRunsCreated.length + 1, data); flowRunsCreated.push(run); return run; },
    'FlowRunLog.create': async () => ({}),
    'FlowNode.update': async () => [1]
  });

  const originalResolve = facebookConversationIdentityService.findOrCreateByPageAndPsid;
  const resolveCalls = [];
  facebookConversationIdentityService.findOrCreateByPageAndPsid = async (values) => {
    resolveCalls.push(values);
    return { contact: { id: 501 }, conversation: { id: 777 }, facebookContact: {}, created: true };
  };
  const originalSendText = facebookMessengerService.sendTextMessage;
  const sendCalls = [];
  facebookMessengerService.sendTextMessage = async (args) => { sendCalls.push(args); return { id: 900, facebookMessageId: 'fbmid-x' }; };

  try {
    await flowService.handleDomainEvent({
      eventType: 'facebook_comment_received', eventId: 'c-private', channel: 'facebook_comment',
      facebookPageId: 9, contactId: 501, commentId: 90, psid: 'psid-commenter-1', text: 'price'
    });
    assert.equal(resolveCalls.length, 1, 'the Messenger conversation must be resolved/created on demand');
    assert.equal(resolveCalls[0].psid, 'psid-commenter-1');
    assert.equal(resolveCalls[0].facebookPageId, 9);
    assert.equal(sendCalls.length, 1);
    assert.equal(sendCalls[0].conversationId, 777);
    assert.equal(sendCalls[0].text, 'Details sent!');
  } finally {
    facebookConversationIdentityService.findOrCreateByPageAndPsid = originalResolve;
    facebookMessengerService.sendTextMessage = originalSendText;
    restore();
  }
});

// 16. Label / lead-status / agent actions are channel-agnostic and work the
// same from a Facebook-triggered flow as from a WhatsApp one.
test('scenario 16: ADD_LABELS and ASSIGN_AGENT flow actions run unaffected by context.channel = facebook_comment', async () => {
  const conversationRow = { id: 55, assignedUserId: null, assignedRoleId: null, async update(patch) { Object.assign(this, patch); } };
  const restore = patchModelMethods({
    'ConversationLabel.findOrCreate': async () => [{}, true],
    'Contact.findByPk': async () => ({ tags: [], async update(patch) { Object.assign(this, patch); } }),
    'Conversation.findByPk': async () => conversationRow,
    'User.findByPk': async (id) => ({ id, status: 'active', isSystemAdmin: true }),
    'ConversationAssignmentHistory.create': async () => ({})
  });
  try {
    const labelResult = await flowActionService.executeOne('ADD_LABELS', { labelIds: [3] }, { channel: 'facebook_comment', contactId: 501, conversationId: 55 }, null);
    assert.deepEqual(labelResult.labelIds, ['3']);

    const assignResult = await flowActionService.executeOne('ASSIGN_AGENT', { userId: 42 }, { channel: 'facebook_comment', contactId: 501, conversationId: 55, leadId: null }, null);
    assert.equal(assignResult.assignedUserId, 42);
  } finally { restore(); }
});

// 17. Duplicate Meta event does not execute the flow twice — flow-run-level
// idempotency (independent of the webhook-delivery ledger tested elsewhere).
test('scenario 17: calling handleDomainEvent twice with the same eventId only starts one flow run', async () => {
  const flowRunsCreated = [];
  let existingRun = null;
  const flow = commentReplyFlow({ source: 'facebook_comment_received' });
  const restore = patchModelMethods({
    ...contactLeadMocks(),
    'Flow.findAll': async () => [flow],
    'FlowRun.findOne': async ({ where }) => (existingRun && String(existingRun.lastWhatsappMessageId) === String(where.lastWhatsappMessageId) ? existingRun : null),
    'FlowRun.create': async (data) => {
      const run = fakeRun(flowRunsCreated.length + 1, data);
      flowRunsCreated.push(run);
      existingRun = run;
      return run;
    },
    'FlowRunLog.create': async () => ({}),
    'FlowNode.update': async () => [1]
  });
  const restoreReply = patchCommentReply();
  try {
    const event = { eventType: 'facebook_comment_received', eventId: 'c-dup', channel: 'facebook_comment', facebookPageId: 9, contactId: 501, commentId: 99, text: 'nice!' };
    await flowService.handleDomainEvent(event);
    await flowService.handleDomainEvent(event);
    assert.equal(flowRunsCreated.length, 1, 'the second identical event must not start a second run');
    assert.equal(patchCommentReply.calls.length, 1, 'the public reply action must not fire twice for the same event');
  } finally { restoreReply(); restore(); }
});

// 15. Contact/Lead reuse — two comments from the same PSID reuse the same
// Contact and Lead instead of creating duplicates.
test('scenario 15: two comments from the same Facebook user reuse the same Contact and Lead (no duplicates)', async () => {
  const contacts = new Map();
  let contactSeq = 0;
  const facebookContacts = new Map();
  const leads = [];
  let leadSeq = 0;
  const comments = [];

  const restore = patchModelMethods({
    'FacebookComment.findOne': async () => null,
    'FacebookComment.create': async (data) => { const row = { id: comments.length + 1, ...data }; comments.push(row); return row; },
    'Contact.findByPk': async (id) => contacts.get(id) || null,
    'Contact.create': async (data) => { contactSeq += 1; const row = { id: contactSeq, ...data }; contacts.set(row.id, row); return row; },
    'FacebookContact.findOne': async ({ where }) => facebookContacts.get(`${where.facebookPageId}:${where.facebookPsid}`) || null,
    'FacebookContact.create': async (data) => {
      const row = { ...data, async update(patch) { Object.assign(row, patch); } };
      facebookContacts.set(`${data.facebookPageId}:${data.facebookPsid}`, row);
      return row;
    },
    'Lead.findOne': async ({ where }) => leads.find((lead) => lead.contactId === where.contactId && (!where.facebookPageId || lead.facebookPageId === where.facebookPageId)) || null,
    'Lead.create': async (data) => { leadSeq += 1; const row = { id: leadSeq, ...data }; leads.push(row); return row; },
    'LeadStatus.findOne': async ({ where }) => ({ id: 1, name: 'New', code: where.code, active: true }),
    'LeadSource.findOne': async ({ where }) => ({ id: 1, name: where.name }),
    'sequelize.transaction': async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } }),
    'sequelize.query': async () => [[]],
    // ingestComment fire-and-forgets a handleDomainEvent dispatch after
    // persisting; stub it to an empty candidate list so that background call
    // never reaches a real (unmocked) database once this test's restore() runs.
    'Flow.findAll': async () => []
  });
  try {
    const first = await facebookCommentService.ingestComment({ facebookPageId: 9, metaCommentId: 'meta-c1', metaPostId: 'post-1', psid: 'psid-reuse-1', displayName: 'Sam', message: 'first comment' });
    const second = await facebookCommentService.ingestComment({ facebookPageId: 9, metaCommentId: 'meta-c2', metaPostId: 'post-1', psid: 'psid-reuse-1', displayName: 'Sam', message: 'second comment' });

    assert.equal(contacts.size, 1, 'only one Contact should ever be created for this psid');
    assert.equal(leads.length, 1, 'only one Lead should ever be created for this contact+page');
    assert.equal(first.comment.contactId, second.comment.contactId);
    assert.equal(first.comment.leadId, second.comment.leadId);

    // Each ingestComment scheduled a fire-and-forget flow-dispatch via
    // setImmediate; drain it while mocks are still in place instead of
    // leaking a real DB-connection attempt past this test's restore().
    await new Promise((resolve) => setImmediate(resolve));
  } finally { restore(); }
});
