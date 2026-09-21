const test = require('node:test');
const assert = require('node:assert/strict');
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

function stubStudent({ portalPasswordHash = 'hash' } = {}) {
  Student.scope = () => ({ findByPk: async () => ({ id: 1, portalPasswordHash }) });
  StudentEnrollment.findAll = async () => [{ id: 10 }];
}

// --- manual "SEND WELCOME MESSAGES" also sends the welcome SMS -------------

test('manual sendOnboarding (SEND WELCOME MESSAGES) dispatches student_welcome SMS alongside the WhatsApp messages', async () => {
  stubStudent();
  automation.dispatchEnrollmentWelcome = async () => ({ status: 'queued' });
  automation.dispatch = async (key) => ({ status: 'queued', templateKey: key });
  let smsCall = null;
  automation.dispatchSms = async (key, studentId, event) => { smsCall = { key, studentId, event }; return { status: 'sent' }; };

  const results = await automation.sendOnboarding(1, { force: false, createdBy: 9 });

  assert.ok(smsCall, 'dispatchSms must be called during a manual welcome-messages send');
  assert.equal(smsCall.key, 'student_welcome');
  assert.equal(smsCall.studentId, 1);
  assert.equal(smsCall.event.forceAttempt, null);
  assert.ok(results.some((item) => item.status === 'sent'));
});

// --- welcome SMS is independent of portal-password / credential state -------

test('welcome SMS is dispatched even when LMS credentials are not ready yet (unlike the WhatsApp student_welcome message, it carries no credentials)', async () => {
  stubStudent({ portalPasswordHash: null });
  automation.dispatchEnrollmentWelcome = async () => ({ status: 'queued' });
  automation.dispatch = async (key) => ({ status: 'queued', templateKey: key });
  let smsCalled = false;
  automation.dispatchSms = async () => { smsCalled = true; return { status: 'sent' }; };

  const results = await automation.sendOnboarding(1, { force: false });

  assert.equal(smsCalled, true);
  const whatsappWelcome = results.find((item) => item.templateKey === 'student_welcome' && item.reason === 'lms_credentials_not_ready');
  assert.ok(whatsappWelcome, 'the WhatsApp student_welcome entry should still report pending_configuration');
});

// --- force resend remains possible for SMS too ------------------------------

test('force resend (FORCE RESEND button) passes a fresh forceAttempt through to the SMS dispatch too', async () => {
  stubStudent();
  automation.dispatchEnrollmentWelcome = async () => ({ status: 'queued' });
  automation.dispatch = async (key) => ({ status: 'queued', templateKey: key });
  let smsForceAttempt;
  automation.dispatchSms = async (key, studentId, event) => { smsForceAttempt = event.forceAttempt; return { status: 'sent' }; };

  await automation.sendOnboarding(1, { force: true, createdBy: 9 });

  assert.ok(smsForceAttempt, 'a forceAttempt id should be generated and passed to dispatchSms on force resend');
});
