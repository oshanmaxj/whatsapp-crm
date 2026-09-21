const test = require('node:test');
const assert = require('node:assert/strict');
const { Automation, Student } = require('../src/models');
const automationSchedulerService = require('../src/services/automationScheduler.service');
const automationService = require('../src/services/automation.service');
const educationService = require('../src/services/education.service');
const auditService = require('../src/services/audit.service');

const originals = {
  automationFindAll: Automation.findAll,
  runAutomation: automationService.runAutomation,
  studentFindByPk: Student.findByPk,
  auditRecord: auditService.record
};

test.afterEach(() => {
  Automation.findAll = originals.automationFindAll;
  automationService.runAutomation = originals.runAutomation;
  Student.findByPk = originals.studentFindByPk;
  auditService.record = originals.auditRecord;
});

// --- automationScheduler.service.js -----------------------------------------

test('automationScheduler.tick() only queries enabled, non-manual, due automations (opt-in by construction)', async () => {
  let capturedWhere = null;
  Automation.findAll = async ({ where }) => { capturedWhere = where; return []; };
  await automationSchedulerService.tick();
  assert.equal(capturedWhere.enabled, true);
  assert.ok(capturedWhere.nextRunAt, 'must filter by nextRunAt being due');
  assert.ok(capturedWhere.scheduleType, 'must exclude manual-schedule automations');
});

test('automationScheduler.tick() calls the SAME automationService.runAutomation() the manual "Run now" button uses, for each due automation', async () => {
  Automation.findAll = async () => [{ id: 1, code: 'CLASS_REMINDER' }, { id: 2, code: 'BIRTHDAY_WISH' }];
  const calledIds = [];
  automationService.runAutomation = async (id) => { calledIds.push(id); return {}; };
  await automationSchedulerService.tick();
  assert.deepEqual(calledIds, [1, 2]);
});

test('automationScheduler.tick() never throws when one automation run fails — it logs and continues with the rest', async () => {
  Automation.findAll = async () => [{ id: 1, code: 'FEE_REMINDER' }, { id: 2, code: 'BIRTHDAY_WISH' }];
  const calledIds = [];
  automationService.runAutomation = async (id) => {
    calledIds.push(id);
    if (id === 1) throw new Error('boom');
    return {};
  };
  await assert.doesNotReject(automationSchedulerService.tick());
  assert.deepEqual(calledIds, [1, 2]);
});

// --- education.service.updateClassSmsReminders --------------------------------

function fakeStudent(overrides = {}) {
  const row = { id: 1, classSmsRemindersEnabled: true, ...overrides };
  row.update = async (fields) => { Object.assign(row, fields); return row; };
  return row;
}

test('updateClassSmsReminders flips the flag and records an audit entry with who/when', async () => {
  const row = fakeStudent({ classSmsRemindersEnabled: true });
  Student.findByPk = async () => row;
  let auditArgs = null;
  auditService.record = async (args) => { auditArgs = args; };

  const result = await educationService.updateClassSmsReminders(1, false, { id: 42 });

  assert.equal(result.classSmsRemindersEnabled, false);
  assert.equal(row.classSmsRemindersEnabled, false);
  assert.equal(auditArgs.userId, 42);
  assert.equal(auditArgs.action, 'STUDENT_CLASS_SMS_REMINDERS_TOGGLED');
  assert.equal(auditArgs.entityId, 1);
  assert.equal(auditArgs.changes.classSmsRemindersEnabled, false);
});

test('updateClassSmsReminders is a no-op (no audit write) when the value does not actually change', async () => {
  const row = fakeStudent({ classSmsRemindersEnabled: true });
  Student.findByPk = async () => row;
  let auditCalled = false;
  auditService.record = async () => { auditCalled = true; };

  await educationService.updateClassSmsReminders(1, true, { id: 42 });

  assert.equal(auditCalled, false);
});

// --- route/permission wiring (structural) -------------------------------------

test('the class-sms-reminders route is gated by its own permission, not left open like the generic updateStudent route', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'src/routes/education.routes.js'), 'utf8');
  assert.match(routes, /router\.patch\('\/students\/:id\/class-sms-reminders', permit\('student\.class_sms_reminders\.manage'\)/);
});
