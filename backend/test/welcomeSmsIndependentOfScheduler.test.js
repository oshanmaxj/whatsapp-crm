const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Student, StudentEnrollment } = require('../src/models');
const automation = require('../src/services/studentMessageAutomation.service');

const originals = {
  scope: Student.scope,
  enrollmentFindAll: StudentEnrollment.findAll,
  dispatch: automation.dispatch,
  dispatchEnrollmentWelcome: automation.dispatchEnrollmentWelcome,
  dispatchSms: automation.dispatchSms
};

test.afterEach(() => {
  Student.scope = originals.scope;
  StudentEnrollment.findAll = originals.enrollmentFindAll;
  automation.dispatch = originals.dispatch;
  automation.dispatchEnrollmentWelcome = originals.dispatchEnrollmentWelcome;
  automation.dispatchSms = originals.dispatchSms;
});

// --- structural: welcome flows never reference the automation scheduler ------
// (This is what makes #11/#12 true by construction, not just by accident of
// current AUTOMATION_SCHEDULER_ENABLED state — even a scheduler bug can never
// affect these paths, because they are never wired to it at all.)

test('#11/#12 education.service.js (registration) never requires/uses automationScheduler.service — welcome SMS is purely event-driven', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/education.service.js'), 'utf8');
  assert.doesNotMatch(source, /automationScheduler/i);
});

test('#11/#12 studentMessageAutomation.service.js (manual SEND WELCOME MESSAGES / force resend) never requires/uses automationScheduler.service', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/studentMessageAutomation.service.js'), 'utf8');
  assert.doesNotMatch(source, /automationScheduler/i);
});

test('#12 registration (dispatchSms via createStudent) still works when called directly, independent of any scheduler/Automation state', async () => {
  // dispatchSms itself never touches the Automation table — this exercises
  // the exact call education.service.js's createStudent() makes.
  const { StudentMessageTemplate } = require('../src/models');
  const { AppSetting } = require('../src/models');
  const originalTemplateFindOne = StudentMessageTemplate.findOne;
  const originalStudentFindByPk = Student.findByPk;
  const originalAppSettingFindOne = AppSetting.findOne;
  const smsMessageService = require('../src/services/smsMessage.service');
  const originalSendAutomated = smsMessageService.sendAutomated;

  AppSetting.findOne = async () => null;
  StudentMessageTemplate.findOne = async () => ({ key: 'student_welcome_sms', body: 'Welcome {{student_name}}', isActive: true, automationEnabled: true });
  Student.findByPk = async () => ({ id: 1, name: 'New Student', studentNo: 'STU-100', phone: '0771234567', contactId: 3, classSmsRemindersEnabled: true });
  let sent = false;
  smsMessageService.sendAutomated = async () => { sent = true; return { status: 'sent' }; };

  const result = await automation.dispatchSms('student_welcome', 1, { eventId: 'student:1', originEvent: 'student_registration' });

  assert.equal(sent, true);
  assert.equal(result.status, 'sent');

  StudentMessageTemplate.findOne = originalTemplateFindOne;
  Student.findByPk = originalStudentFindByPk;
  AppSetting.findOne = originalAppSettingFindOne;
  smsMessageService.sendAutomated = originalSendAutomated;
});

test('#11 manual sendOnboarding still dispatches the welcome SMS with no reference to scheduler/Automation state', async () => {
  Student.scope = () => ({ findByPk: async () => ({ id: 1, portalPasswordHash: 'hash' }) });
  StudentEnrollment.findAll = async () => [{ id: 10 }];
  automation.dispatchEnrollmentWelcome = async () => ({ status: 'queued' });
  automation.dispatch = async (key) => ({ status: 'queued', templateKey: key });
  let smsCalled = false;
  automation.dispatchSms = async () => { smsCalled = true; return { status: 'sent' }; };

  await automation.sendOnboarding(1, { force: false, createdBy: 9 });

  assert.equal(smsCalled, true);
});
