const test = require('node:test');
const assert = require('node:assert/strict');
const matcher = require('../src/services/flowTriggerMatcher.service');
const flowService = require('../src/services/flow.service');
const flowActionService = require('../src/services/flowAction.service');
const models = require('../src/models');

const flow = (config = {}) => ({ id: 1, whatsappAccountId: 7, triggerType: 'inbound_message', triggerKeywords: [], triggerConfig: config });

test('advanced keyword triggers support exact, contains, starts, ends, multiple, and Sinhala Unicode', () => {
  assert.equal(matcher.keywordMatches('  HELLO  ', ['hello'], 'exact'), true);
  assert.equal(matcher.keywordMatches('please send details', ['send'], 'contains'), true);
  assert.equal(matcher.keywordMatches('Course details', ['course'], 'starts_with'), true);
  assert.equal(matcher.keywordMatches('apply now', ['now'], 'ends_with'), true);
  assert.equal(matcher.keywordMatches('pricing', ['hello', 'pricing'], 'exact'), true);
  assert.equal(matcher.keywordMatches('  ආයුබෝවන්   ඔබට ', ['ආයුබෝවන් ඔබට'], 'exact'), true);
});

test('trigger source matching covers message, first message, replies, and domain events', () => {
  assert.equal(matcher.matchesTrigger(flow({ source: 'any_message' }), { text: 'x', whatsappAccountId: 7 }), true);
  assert.equal(matcher.matchesTrigger(flow({ source: 'first_message' }), { text: 'x', isFirstMessage: true, whatsappAccountId: 7 }), true);
  assert.equal(matcher.matchesTrigger(flow({ source: 'button_reply' }), { buttonPayload: 'b', messageType: 'button_reply', whatsappAccountId: 7 }), true);
  assert.equal(matcher.matchesTrigger(flow({ source: 'list_reply' }), { buttonPayload: 'l', interactiveType: 'list_reply', whatsappAccountId: 7 }), true);
  for (const eventType of ['payment_event', 'label_added', 'contact_created', 'lead_status_changed']) assert.equal(matcher.matchesTrigger(flow({ source: eventType }), { eventType, whatsappAccountId: 7 }), true);
});

test('regex triggers require privileged execution and account scope stays isolated', () => {
  const candidate = flow({ source: 'inbound_message', keywords: ['^pay\\s+now$'], matchType: 'regex' });
  assert.equal(matcher.matchesTrigger(candidate, { text: 'pay now', whatsappAccountId: 7 }, { allowRegex: false }), false);
  assert.equal(matcher.matchesTrigger(candidate, { text: 'pay now', whatsappAccountId: 7 }, { allowRegex: true }), true);
  assert.equal(matcher.matchesTrigger(candidate, { text: 'pay now', whatsappAccountId: 8 }, { allowRegex: true }), false);
});

test('stable button payloads distinguish identical titles on different nodes', () => {
  const first = flowService.encodedButtonId(1, 'node-a', 'same-id');
  const second = flowService.encodedButtonId(1, 'node-b', 'same-id');
  assert.notEqual(first, second);
  assert.equal(flowService.decodedButtonId(first), 'same-id');
});

test('label and list actions add and remove records', async () => {
  const originals = { labelAdd: models.ConversationLabel.findOrCreate, labelRemove: models.ConversationLabel.destroy, listAdd: models.ContactListMember.findOrCreate, listRemove: models.ContactListMember.destroy };
  const calls = [];
  models.ConversationLabel.findOrCreate = async (options) => { calls.push(['label-add', options.where]); return [{}, true]; };
  models.ConversationLabel.destroy = async (options) => { calls.push(['label-remove', options.where]); return 1; };
  models.ContactListMember.findOrCreate = async (options) => { calls.push(['list-add', options.where]); return [{}, true]; };
  models.ContactListMember.destroy = async (options) => { calls.push(['list-remove', options.where]); return 1; };
  try {
    const context = { contactId: 2, conversationId: 3, flowRun: { id: 4 } };
    await flowActionService.executeOne('ADD_LABELS', { labelIds: [5] }, context);
    await flowActionService.executeOne('REMOVE_LABELS', { labelIds: [5] }, context);
    await flowActionService.executeOne('ADD_TO_LISTS', { listIds: [6] }, context);
    await flowActionService.executeOne('REMOVE_FROM_LISTS', { listIds: [6] }, context);
    assert.deepEqual(calls.map((row) => row[0]), ['label-add', 'label-remove', 'list-add', 'list-remove']);
  } finally { models.ConversationLabel.findOrCreate = originals.labelAdd; models.ConversationLabel.destroy = originals.labelRemove; models.ContactListMember.findOrCreate = originals.listAdd; models.ContactListMember.destroy = originals.listRemove; }
});

test('sequence subscribe avoids duplicates and unsubscribe stops active subscription', async () => {
  const originalFind = models.SequenceSubscription.findOrCreate;
  const originalUpdate = models.SequenceSubscription.update;
  let creates = 0; let unsubscribed = false;
  models.SequenceSubscription.findOrCreate = async () => { creates += 1; return [{ status: 'active', update: async () => {} }, false]; };
  models.SequenceSubscription.update = async () => { unsubscribed = true; };
  try {
    const context = { contactId: 2, flowRun: { id: 4 }, nodeKey: 'start' };
    await flowActionService.executeOne('SUBSCRIBE_SEQUENCE', { sequenceIds: [9] }, context);
    await flowActionService.executeOne('UNSUBSCRIBE_SEQUENCE', { sequenceIds: [9] }, context);
    assert.equal(creates, 1); assert.equal(unsubscribed, true);
  } finally { models.SequenceSubscription.findOrCreate = originalFind; models.SequenceSubscription.update = originalUpdate; }
});

test('agent assignment and unassignment reuse the canonical conversation and write history', async () => {
  const originalConversation = models.Conversation.findByPk;
  const originalUser = models.User.findByPk;
  const originalHistory = models.ConversationAssignmentHistory.create;
  const conversation = { id: 30, assignedUserId: null, assignedRoleId: 4, update: async (patch) => Object.assign(conversation, patch) };
  const history = [];
  models.Conversation.findByPk = async () => conversation;
  models.User.findByPk = async (id) => ({ id, status: 'active' });
  models.ConversationAssignmentHistory.create = async (row) => history.push(row);
  try {
    const context = { conversationId: 30, actor: { userId: 1 } };
    await flowActionService.executeOne('ASSIGN_AGENT', { userId: 8 }, context);
    await flowActionService.executeOne('UNASSIGN_AGENT', {}, context);
    assert.equal(conversation.id, 30); assert.equal(conversation.assignedUserId, null); assert.equal(history.length, 2);
  } finally { models.Conversation.findByPk = originalConversation; models.User.findByPk = originalUser; models.ConversationAssignmentHistory.create = originalHistory; }
});

test('custom field action renders flow variables without arbitrary code execution', async () => {
  const original = models.Contact.findByPk;
  const contact = { customFields: {}, update: async (patch) => Object.assign(contact, patch) };
  models.Contact.findByPk = async () => contact;
  try {
    await flowActionService.executeOne('SET_CUSTOM_FIELD', { entity: 'contact', field: 'preferred_course', value: '{{variables.course}}' }, { contactId: 2, variables: { course: 'English' } });
    assert.equal(contact.customFields.preferred_course, 'English');
    await assert.rejects(flowActionService.executeOne('SET_CUSTOM_FIELD', { entity: 'contact', field: 'x;process.exit()', value: 'bad' }, { contactId: 2 }), { code: 'FLOW_CUSTOM_FIELD_INVALID' });
  } finally { models.Contact.findByPk = original; }
});

test('optional action failure is audited and continues without losing the inbound flow', async () => {
  const originalFind = models.FlowActionExecution.findOrCreate;
  const execution = { status: 'running', update: async (patch) => Object.assign(execution, patch) };
  models.FlowActionExecution.findOrCreate = async () => [execution, true];
  try {
    const result = await flowActionService.executeFlowActions({ actions: [{ id: 'calendar', actionType: 'CREATE_CALENDAR_EVENT', enabled: true, failurePolicy: 'CONTINUE' }], context: { flowRun: { id: 1 }, nodeKey: 'start', sourceMessageId: 'wamid.1' }, phase: 'pre' });
    assert.equal(result.directive, undefined); assert.equal(result.results[0].status, 'failed'); assert.equal(execution.status, 'failed');
  } finally { models.FlowActionExecution.findOrCreate = originalFind; }
});

test('same webhook retry does not execute an action twice', async () => {
  const originalFind = models.FlowActionExecution.findOrCreate;
  models.FlowActionExecution.findOrCreate = async () => [{ status: 'completed' }, false];
  try {
    const result = await flowActionService.executeFlowActions({ actions: [{ id: 'labels', actionType: 'ADD_LABELS', config: { labelIds: [1] } }], context: { flowRun: { id: 1 }, nodeKey: 'start', sourceMessageId: 'wamid.retry' }, phase: 'pre' });
    assert.equal(result.results[0].status, 'duplicate');
  } finally { models.FlowActionExecution.findOrCreate = originalFind; }
});

test('starting a published child flow preserves account and canonical conversation', async () => {
  const originals = { flow: models.Flow.findOne, conversation: models.Conversation.findByPk, run: models.FlowRun.findByPk, linkFind: models.FlowRunLink.findOne, linkCreate: models.FlowRunLink.findOrCreate, execute: flowService.executeFlow };
  models.Flow.findOne = async () => ({ id: 2, status: 'published', whatsappAccountId: 7, nodes: [], connections: [] });
  models.Conversation.findByPk = async () => ({ id: 33, contactId: 22, whatsappAccountId: 7 });
  models.FlowRun.findByPk = async () => ({ id: 10, flowId: 1 });
  models.FlowRunLink.findOne = async () => null;
  let link; models.FlowRunLink.findOrCreate = async (options) => { link = options.defaults; return [link, true]; };
  let childContext; flowService.executeFlow = async (_target, context) => { childContext = context; return { id: 11 }; };
  try {
    const result = await flowService.startFlowFromAction({ targetFlowId: 2, contactId: 22, conversationId: 33, whatsappAccountId: 7, sourceFlowRunId: 10, sourceNodeId: 'button-node', variables: { x: 1 } });
    assert.equal(result.id, 11); assert.equal(childContext.conversationId, 33); assert.equal(childContext.whatsappAccountId, 7); assert.equal(link.parentFlowRunId, 10);
  } finally { models.Flow.findOne = originals.flow; models.Conversation.findByPk = originals.conversation; models.FlowRun.findByPk = originals.run; models.FlowRunLink.findOne = originals.linkFind; models.FlowRunLink.findOrCreate = originals.linkCreate; flowService.executeFlow = originals.execute; }
});

test('disabled targets, circular references, and maximum nested depth are rejected', async () => {
  const originalFlow = models.Flow.findOne;
  const originalConversation = models.Conversation.findByPk;
  const originalRun = models.FlowRun.findByPk;
  const originalLink = models.FlowRunLink.findOne;
  try {
    models.Flow.findOne = async () => null;
    await assert.rejects(flowService.startFlowFromAction({ targetFlowId: 2 }), { code: 'FLOW_TARGET_UNAVAILABLE' });
    models.Flow.findOne = async () => ({ id: 2, whatsappAccountId: 7, nodes: [], connections: [] });
    models.Conversation.findByPk = async () => ({ id: 33, contactId: 22, whatsappAccountId: 7 });
    models.FlowRun.findByPk = async (id) => ({ id, flowId: 2 });
    await assert.rejects(flowService.startFlowFromAction({ targetFlowId: 2, contactId: 22, conversationId: 33, whatsappAccountId: 7, sourceFlowRunId: 10 }), { code: 'FLOW_CIRCULAR_REFERENCE' });
    models.FlowRun.findByPk = async (id) => ({ id, flowId: Number(id) + 100 });
    models.FlowRunLink.findOne = async ({ where }) => ({ parentFlowRunId: Number(where.childFlowRunId) + 1 });
    await assert.rejects(flowService.startFlowFromAction({ targetFlowId: 2, contactId: 22, conversationId: 33, whatsappAccountId: 7, sourceFlowRunId: 10 }), { code: 'FLOW_NESTED_DEPTH_EXCEEDED' });
  } finally { models.Flow.findOne = originalFlow; models.Conversation.findByPk = originalConversation; models.FlowRun.findByPk = originalRun; models.FlowRunLink.findOne = originalLink; }
});

test('SSRF protection rejects private webhook targets', async () => {
  await assert.rejects(flowActionService.safeWebhookUrl('https://127.0.0.1/internal'), { code: 'FLOW_WEBHOOK_SSRF_BLOCKED' });
});

test('advanced flow action migration is additive, transactional, and idempotent', async () => {
  const migration = require('../migrations/040_advanced_flow_actions');
  const Sequelize = require('sequelize');
  const schemas = { contacts: {}, leads: {}, conversations: {} };
  const indexes = {};
  let transactions = 0;
  const qi = {
    sequelize: { getDialect: () => 'postgres', transaction: async (callback) => { transactions += 1; return callback({ id: transactions }); } },
    showAllTables: async () => Object.keys(schemas),
    describeTable: async (table) => ({ ...schemas[table] }),
    createTable: async (table, columns) => { schemas[table] = { ...columns }; },
    dropTable: async (table) => { delete schemas[table]; },
    addColumn: async (table, column, definition) => { schemas[table][column] = definition; },
    removeColumn: async (table, column) => { delete schemas[table][column]; },
    showIndex: async (table) => indexes[table] || [],
    addIndex: async (table, _fields, options) => { indexes[table] = [...(indexes[table] || []), { name: options.name }]; }
  };
  await migration.up(qi, Sequelize);
  await migration.up(qi, Sequelize);
  assert.equal(transactions, 2);
  assert.ok(schemas.flow_action_executions);
  assert.ok(schemas.flow_run_links);
  assert.ok(schemas.contacts.custom_fields);
  assert.equal(indexes.contact_list_members.filter((row) => row.name === 'contact_list_members_unique').length, 1);
});
