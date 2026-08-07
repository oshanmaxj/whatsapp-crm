const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeSequence, validateSequence } = require('../src/services/reminderSequence.service');

const textStep = (values = {}) => ({
  id: 10, delayValue: 1, delayUnit: 'hours', sessionMessageType: 'text', body: 'Hello', ...values
});

test('text-only edit payload normalizes without losing the existing step ID', () => {
  const payload = normalizeSequence({ name: 'Text reminders', status: 'draft', steps: [textStep()] });
  validateSequence(payload);
  assert.equal(payload.steps[0].id, 10);
  assert.equal(payload.steps[0].body, 'Hello');
});

test('interactive edit preserves stable button IDs and accepts draft without fallback', () => {
  const payload = normalizeSequence({ name: 'Interactive', status: 'draft', steps: [textStep({
    sessionMessageType: 'buttons', templateId: '', interactiveConfig: { buttons: [
      { title: 'Continue', buttonId: 'continue_v1', behavior: 'trigger_keyword', triggerKeyword: 'CONTINUE' }
    ] }
  })] });
  validateSequence(payload);
  assert.equal(payload.steps[0].interactiveConfig.buttons[0].buttonId, 'continue_v1');
  assert.equal(payload.steps[0].templateId, null);
});

test('duplicate stable button IDs and missing trigger data are rejected with step fields', () => {
  const duplicate = normalizeSequence({ name: 'Bad buttons', steps: [textStep({
    sessionMessageType: 'buttons', interactiveConfig: { buttons: [
      { title: 'One', buttonId: 'same' }, { title: 'Two', buttonId: 'same' }
    ] }
  })] });
  assert.throws(() => validateSequence(duplicate), error => error.status === 422 && Boolean(error.errors['steps.0.interactiveConfig.buttons.1.buttonId']));
  const missingKeyword = normalizeSequence({ name: 'Bad trigger', steps: [textStep({
    sessionMessageType: 'buttons', interactiveConfig: { buttons: [{ title: 'Go', buttonId: 'go', behavior: 'trigger_keyword' }] }
  })] });
  assert.throws(() => validateSequence(missingKeyword), error => error.status === 422 && Boolean(error.errors['steps.0.interactiveConfig.buttons.0.triggerKeyword']));
});

test('nested update uses a single transaction and parks old ordering before writes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/reminderSequence.service.js'), 'utf8');
  assert.match(source, /sequelize\.transaction\(async transaction/);
  assert.match(source, /step_number \+ /);
  assert.match(source, /step\.update\(stepValues, \{ transaction \}\)/);
  assert.match(source, /ReminderSequenceStep\.create\(stepValues, \{ transaction \}\)/);
  assert.match(source, /ReminderSequenceStep\.destroy\([\s\S]*transaction/);
  assert.doesNotMatch(source, /\.sync\(/);
});

test('activation validation requires an approved fallback while draft validation does not', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/reminderSequence.service.js'), 'utf8');
  assert.match(source, /activation && step\.enabled !== false/);
  assert.match(source, /template\.status !== 'APPROVED'/);
  assert.match(source, /status === REMINDER_SEQUENCE_STATUS\.ACTIVE[\s\S]*validateReferences/);
});
