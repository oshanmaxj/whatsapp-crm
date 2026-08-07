const test = require('node:test');
const assert = require('node:assert/strict');
const models = require('../src/models');
const reminderService = require('../src/services/reminderSequence.service');
const messagingWindow = require('../src/services/messagingWindow.service');
const whatsapp = require('../src/services/whatsapp.service');

function row(values) {
  return { ...values, async update(patch) { Object.assign(this, patch); return this; }, async reload() { return this; } };
}

async function fixture({ isOpen, send }) {
  const originals = {
    transaction: models.sequelize.transaction,
    executionByPk: models.ReminderExecution.findByPk,
    executionFind: models.ReminderExecution.findOne,
    executionCreate: models.ReminderExecution.findOrCreate,
    subscriptionByPk: models.ReminderSubscription.findByPk,
    sequenceByPk: models.ReminderSequence.findByPk,
    stepByPk: models.ReminderSequenceStep.findByPk,
    stepFind: models.ReminderSequenceStep.findOne,
    conversationByPk: models.Conversation.findByPk,
    window: messagingWindow.getMessagingWindow,
    send: whatsapp.sendTextMessage
  };
  const execution = row({ id: 1, subscriptionId: 2, sequenceStepId: 3, status: 'processing', attemptCount: 1, scheduledAt: new Date(), whatsappMessageId: null });
  const subscription = row({ id: 2, sequenceId: 4, conversationId: 5, contactId: 6, whatsappAccountId: 7, phone: '94770000000', status: 'active', currentStep: 0, nextRunAt: new Date(Date.now() - 1000), replyResumeAt: null });
  const sequence = row({ id: 4 });
  const step = row({ id: 3, sequenceId: 4, stepNumber: 1, delayValue: 1, delayUnit: 'hours', sessionMessageType: 'text', body: 'Hello' });
  const nextStep = row({ id: 8, sequenceId: 4, stepNumber: 2, delayValue: 48, delayUnit: 'hours', sessionMessageType: 'text', body: 'Later' });
  const conversation = row({ id: 5, contactId: 6, whatsappAccountId: 7 });
  let nextCreated = false;
  models.sequelize.transaction = async callback => callback({ LOCK: { UPDATE: 'UPDATE' } });
  models.ReminderExecution.findByPk = async () => execution;
  models.ReminderExecution.findOne = async () => null;
  models.ReminderExecution.findOrCreate = async () => { nextCreated = true; return [row({ id: 9 }), true]; };
  models.ReminderSubscription.findByPk = async () => subscription;
  models.ReminderSequence.findByPk = async () => sequence;
  models.ReminderSequenceStep.findByPk = async () => step;
  models.ReminderSequenceStep.findOne = async () => nextStep;
  models.Conversation.findByPk = async () => conversation;
  messagingWindow.getMessagingWindow = async () => ({ isOpen });
  whatsapp.sendTextMessage = send;
  try {
    await reminderService.processOne(execution.id);
    return { execution, subscription, nextCreated };
  } finally {
    models.sequelize.transaction = originals.transaction;
    models.ReminderExecution.findByPk = originals.executionByPk;
    models.ReminderExecution.findOne = originals.executionFind;
    models.ReminderExecution.findOrCreate = originals.executionCreate;
    models.ReminderSubscription.findByPk = originals.subscriptionByPk;
    models.ReminderSequence.findByPk = originals.sequenceByPk;
    models.ReminderSequenceStep.findByPk = originals.stepByPk;
    models.ReminderSequenceStep.findOne = originals.stepFind;
    models.Conversation.findByPk = originals.conversationByPk;
    messagingWindow.getMessagingWindow = originals.window;
    whatsapp.sendTextMessage = originals.send;
  }
}

test('closed window fails only the due step without a Meta ID and schedules the later step', async () => {
  let sent = false;
  const result = await fixture({ isOpen: false, send: async () => { sent = true; } });
  assert.equal(sent, false);
  assert.equal(result.execution.status, 'failed');
  assert.equal(result.execution.errorCode, 'MESSAGING_WINDOW_CLOSED');
  assert.equal(result.execution.whatsappMessageId, null);
  assert.equal(result.subscription.status, 'active');
  assert.equal(result.nextCreated, true);
});

test('open window marks sent only when Meta returns a message ID', async () => {
  const result = await fixture({ isOpen: true, send: async () => ({ id: 'wamid-open' }) });
  assert.equal(result.execution.status, 'sent');
  assert.equal(result.execution.whatsappMessageId, 'wamid-open');
  assert.equal(result.subscription.status, 'active');
});

test('Meta rejection is sanitized, fails the step, and never falls back to a template', async () => {
  const error = Object.assign(new Error('Meta rejected'), { response: { data: { error: { code: 131047, error_user_msg: 'Re-engagement message required' } } } });
  const result = await fixture({ isOpen: true, send: async () => { throw error; } });
  assert.equal(result.execution.status, 'failed');
  assert.equal(result.execution.errorCode, '131047');
  assert.match(result.execution.errorMessage, /Re-engagement/);
  assert.equal(result.execution.whatsappMessageId, null);
  assert.equal(result.nextCreated, true);
});
