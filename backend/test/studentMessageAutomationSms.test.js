const test = require('node:test');
const assert = require('node:assert/strict');
const { Student, StudentMessageTemplate, AppSetting } = require('../src/models');
const automation = require('../src/services/studentMessageAutomation.service');
const smsMessageService = require('../src/services/smsMessage.service');

const originals = {
  templateFindOne: StudentMessageTemplate.findOne,
  studentFindByPk: Student.findByPk,
  sendAutomated: smsMessageService.sendAutomated,
  appSettingFindOne: AppSetting.findOne
};

test.beforeEach(() => {
  // context() always looks up the company profile AppSetting — stub it to
  // avoid a real DB connection in every test, regardless of what each test
  // is actually exercising.
  AppSetting.findOne = async () => null;
});

test.afterEach(() => {
  StudentMessageTemplate.findOne = originals.templateFindOne;
  Student.findByPk = originals.studentFindByPk;
  smsMessageService.sendAutomated = originals.sendAutomated;
  AppSetting.findOne = originals.appSettingFindOne;
});

function mockTemplate(overrides = {}) {
  return {
    key: 'student_welcome_sms',
    body: 'Hello {{student_name}}, welcome to {{company_name}}! Reg No: {{registration_number}}.',
    isActive: true,
    automationEnabled: true,
    ...overrides
  };
}

function mockStudent(overrides = {}) {
  return {
    id: 1,
    name: 'Jane Doe',
    studentNo: 'STU-001',
    phone: '0771234567',
    contactId: 55,
    classSmsRemindersEnabled: true,
    course: null,
    batch: null,
    ...overrides
  };
}

// --- template lookup / gating -------------------------------------------

test('dispatchSms returns not_configured when no SMS template row exists for the key', async () => {
  StudentMessageTemplate.findOne = async () => null;
  const result = await automation.dispatchSms('student_welcome', 1, {});
  assert.equal(result.status, 'not_configured');
  assert.equal(result.templateKey, 'student_welcome_sms');
});

test('dispatchSms returns disabled when the SMS template is inactive or automation-disabled', async () => {
  StudentMessageTemplate.findOne = async () => mockTemplate({ isActive: false });
  let result = await automation.dispatchSms('student_welcome', 1, {});
  assert.equal(result.status, 'disabled');

  StudentMessageTemplate.findOne = async () => mockTemplate({ automationEnabled: false });
  result = await automation.dispatchSms('student_welcome', 1, {});
  assert.equal(result.status, 'disabled');
});

test('dispatchSms skips a student with an invalid/missing phone number without throwing', async () => {
  StudentMessageTemplate.findOne = async () => mockTemplate();
  Student.findByPk = async () => mockStudent({ phone: '' });
  const result = await automation.dispatchSms('student_welcome', 1, {});
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'invalid_phone');
});

// --- class reminder per-student opt-out ----------------------------------

test('dispatchSms skips class_reminder when the student has Class SMS Reminders turned off', async () => {
  StudentMessageTemplate.findOne = async () => mockTemplate({ key: 'class_reminder_sms', body: 'Class today' });
  Student.findByPk = async () => mockStudent({ classSmsRemindersEnabled: false });
  const result = await automation.dispatchSms('class_reminder', 1, {});
  assert.equal(result.status, 'student_opted_out');
});

test('dispatchSms still sends class_reminder when the student has it enabled', async () => {
  StudentMessageTemplate.findOne = async () => mockTemplate({ key: 'class_reminder_sms', body: 'Class today for {{student_name}}' });
  Student.findByPk = async () => mockStudent({ classSmsRemindersEnabled: true });
  let captured = null;
  smsMessageService.sendAutomated = async (args) => { captured = args; return { status: 'sent' }; };
  const result = await automation.dispatchSms('class_reminder', 1, { smsOccurrenceKey: 'class-reminder:99' });
  assert.equal(result.status, 'sent');
  assert.match(captured.message, /Class today for Jane Doe/);
});

test('the class-reminder opt-out is never bypassed by a forceAttempt (force is a welcome-resend concept, not a consent override)', async () => {
  StudentMessageTemplate.findOne = async () => mockTemplate({ key: 'class_reminder_sms', body: 'Class today' });
  Student.findByPk = async () => mockStudent({ classSmsRemindersEnabled: false });
  const result = await automation.dispatchSms('class_reminder', 1, { forceAttempt: 'force-uuid' });
  assert.equal(result.status, 'student_opted_out');
});

test('the opt-out flag has no effect on non-class-reminder templates (e.g. student_welcome still sends)', async () => {
  StudentMessageTemplate.findOne = async () => mockTemplate();
  Student.findByPk = async () => mockStudent({ classSmsRemindersEnabled: false });
  smsMessageService.sendAutomated = async () => ({ status: 'sent' });
  const result = await automation.dispatchSms('student_welcome', 1, {});
  assert.equal(result.status, 'sent');
});

// --- rendering -------------------------------------------------------------

test('renderSmsBody substitutes variables and trims collapsed blank lines', () => {
  const body = automation.renderSmsBody(
    { body: 'Hi {{student_name}}\n\n\n\nBye' },
    { student_name: 'Sam' }
  );
  assert.equal(body, 'Hi Sam\n\nBye');
});

test('dispatchSms skips when the rendered SMS body is empty', async () => {
  StudentMessageTemplate.findOne = async () => mockTemplate({ body: '   ' });
  Student.findByPk = async () => mockStudent();
  const result = await automation.dispatchSms('student_welcome', 1, {});
  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'empty_template');
});

// --- idempotency: dedupeKey construction ------------------------------------

test('dispatchSms derives a distinct, occurrence-scoped dedupeKey (not shared with a plain student-id key or another occurrence)', async () => {
  StudentMessageTemplate.findOne = async () => mockTemplate({ key: 'birthday_wish_sms', body: 'Happy Birthday {{student_name}}' });
  Student.findByPk = async () => mockStudent();
  const seen = [];
  smsMessageService.sendAutomated = async (args) => { seen.push(args.dedupeKey); return { status: 'sent' }; };

  await automation.dispatchSms('birthday_wish', 1, { smsOccurrenceKey: 'birthday:1:2025' });
  await automation.dispatchSms('birthday_wish', 1, { smsOccurrenceKey: 'birthday:1:2026' });

  assert.equal(seen.length, 2);
  assert.notEqual(seen[0], seen[1]);
  assert.equal(seen[0].length, 64); // sha256 hex
});

test('dispatchSms passes source=<templateKey>_sms and the student/contact ids through to sendAutomated', async () => {
  StudentMessageTemplate.findOne = async () => mockTemplate({ key: 'payment_reminder_sms', body: 'Pay {{payment_amount}}' });
  Student.findByPk = async () => mockStudent({ id: 42, contactId: 7 });
  let captured = null;
  smsMessageService.sendAutomated = async (args) => { captured = args; return { status: 'sent' }; };

  await automation.dispatchSms('payment_reminder', 42, { smsOccurrenceKey: 'fee-reminder:5', paymentAmount: 1000 });

  assert.equal(captured.source, 'payment_reminder_sms');
  assert.equal(captured.studentId, 42);
  assert.equal(captured.contactId, 7);
  assert.match(captured.message, /Pay 1000/);
});
