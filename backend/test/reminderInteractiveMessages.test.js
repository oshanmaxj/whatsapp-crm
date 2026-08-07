const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const buttons = require('../src/services/whatsappButtonConfig.service');
const matcher = require('../src/services/flowTriggerMatcher.service');

test('canonical reminder buttons preserve stable IDs, order and normalized Unicode keywords', () => {
  const result = buttons.validateButtons({ buttons: [
    { title: 'Join Seminar', buttonId: 'reminder_join_v1', behavior: 'trigger_keyword', triggerKeyword: '  JOIN   Seminar ' },
    { title: 'සිංහල', buttonId: 'sinhala_v1', behavior: 'trigger_keyword', triggerKeyword: ' ආයුබෝවන්   ඔබට ' }
  ] });
  assert.deepEqual(result.errors, {});
  assert.equal(result.buttons[0].buttonId, 'reminder_join_v1');
  assert.equal(result.buttons[0].triggerKeyword, 'JOIN Seminar');
  assert.equal(result.buttons[1].triggerKeyword, 'ආයුබෝවන් ඔබට');
  assert.deepEqual(buttons.metaReplyButtons(result.buttons).map(item => item.id), ['reminder_join_v1', 'sinhala_v1']);
  assert.equal(matcher.keywordMatches(' ආයුබෝවන්  ඔබට ', ['ආයුබෝවන් ඔබට'], 'exact'), true);
});

test('more than three buttons and duplicate IDs are rejected', () => {
  const result = buttons.validateButtons([
    { title: 'One', buttonId: 'same' }, { title: 'Two', buttonId: 'same' },
    { title: 'Three', buttonId: 'three' }, { title: 'Four', buttonId: 'four' }
  ]);
  assert.match(result.errors.buttons, /at most 3/);
  assert.match(result.errors['buttons.1.buttonId'], /unique/);
});

test('migration is advisory locked, transactional and passes transaction to schema queries', () => {
  const source = fs.readFileSync(path.join(__dirname, '../migrations/056_reminder_interactive_messages.js'), 'utf8');
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /describeTable\(table, \{ transaction \}\)/);
  assert.match(source, /addColumn\(table, column, definition, \{ transaction \}\)/);
  assert.match(source, /transaction\.commit/);
  assert.match(source, /transaction\.rollback/);
});

test('inside and outside service-window payload paths remain distinct', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/services/reminderSequence.service.js'), 'utf8');
  assert.match(source, /sendInteractiveMessage/);
  assert.match(source, /sendMediaMessage/);
  assert.match(source, /MESSAGING_WINDOW_CLOSED/);
  assert.match(source, /whatsappMessageId: null/);
  assert.doesNotMatch(source, /sendTemplateMessage/);
});

test('button replies reuse the canonical Flow trigger matcher path', () => {
  const router = fs.readFileSync(path.join(__dirname, '../src/services/reminderInteraction.service.js'), 'utf8');
  const inbound = fs.readFileSync(path.join(__dirname, '../src/services/whatsapp.service.js'), 'utf8');
  assert.match(router, /button\.triggerKeyword/);
  assert.match(inbound, /reminderInteraction\.service'\)\.resolve/);
  assert.match(inbound, /flow\.service'\)\.handleInboundMessage\(input\)/);
});
