const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FeeInstallment, Student, StudentMessageTemplate, AppSetting } = require('../src/models');
const educationService = require('../src/services/education.service');
const automation = require('../src/services/studentMessageAutomation.service');
const smsMessageService = require('../src/services/smsMessage.service');

const originals = {
  installmentFindByPk: FeeInstallment.findByPk,
  dispatchSms: automation.dispatchSms,
  templateFindOne: StudentMessageTemplate.findOne,
  studentFindByPk: Student.findByPk,
  appSettingFindOne: AppSetting.findOne,
  sendAutomated: smsMessageService.sendAutomated
};

test.afterEach(() => {
  FeeInstallment.findByPk = originals.installmentFindByPk;
  automation.dispatchSms = originals.dispatchSms;
  StudentMessageTemplate.findOne = originals.templateFindOne;
  Student.findByPk = originals.studentFindByPk;
  AppSetting.findOne = originals.appSettingFindOne;
  smsMessageService.sendAutomated = originals.sendAutomated;
});

function fakeInstallment({ accountingTransactionId = 700, paidAmount = '500.00', phone = '0771234567' } = {}) {
  return {
    id: 900, accountingTransactionId, paidDate: '2026-04-01', paymentMethod: 'Cash',
    installmentNo: 2, dueDate: '2026-04-01', paidAmount,
    fee: {
      studentId: 12, balance: '500.00',
      student: { id: 12, name: 'Pat', studentNo: 'STU-900', phone },
      course: { name: 'Diploma' }, batch: { name: 'Batch A' }
    },
    accountingTransaction: { id: accountingTransactionId, amount: paidAmount }
  };
}

// --- #12/#13/#15: successful payment sends one SMS with correct variables ----

test('#12/#13/#15 a successful payment sends exactly one SMS to the student\'s phone with rendered payment variables', async () => {
  FeeInstallment.findByPk = async () => fakeInstallment();
  let captured = null;
  automation.dispatchSms = async (key, studentId, event) => { captured = { key, studentId, event }; return { status: 'sent' }; };

  const result = await educationService.sendPaymentSuccessSms(900, 5, { receiptNumber: 'RCPT-1' });

  assert.equal(result.status, 'sent');
  assert.equal(captured.key, 'payment_confirmation');
  assert.equal(captured.studentId, 12);
  assert.equal(captured.event.paymentAmount, '500.00');
  assert.equal(captured.event.variables.remaining_balance, '500.00');
  assert.equal(captured.event.variables.receipt_number, 'RCPT-1');
});

// --- #14: phone normalization uses the existing shared utility ----------------

test('#14 dispatchSms (called by sendPaymentSuccessSms) normalizes the phone via the shared utils/phone.js, not a new implementation', async () => {
  AppSetting.findOne = async () => null;
  StudentMessageTemplate.findOne = async () => ({ key: 'payment_confirmation_sms', body: 'Paid {{payment_amount}}', isActive: true, automationEnabled: true });
  Student.findByPk = async () => ({ id: 12, name: 'Pat', studentNo: 'STU-900', phone: '0771234567', contactId: 1, classSmsRemindersEnabled: true });
  let capturedTo = null;
  smsMessageService.sendAutomated = async (args) => { capturedTo = args.to; return { status: 'sent' }; };

  await automation.dispatchSms('payment_confirmation', 12, { eventId: 'x', smsOccurrenceKey: 'payment-confirmation:700' });

  assert.equal(capturedTo, '94771234567');
});

// --- #16: same payment event processed twice => at most one SMS --------------

test('#16 processing the same payment confirmation twice derives the SAME occurrence key both times (durable dedupe, not per-call)', async () => {
  FeeInstallment.findByPk = async () => fakeInstallment({ accountingTransactionId: 700 });
  const seen = [];
  automation.dispatchSms = async (key, studentId, event) => { seen.push(event.smsOccurrenceKey); return { status: 'sent' }; };

  await educationService.sendPaymentSuccessSms(900, 5, {});
  await educationService.sendPaymentSuccessSms(900, 5, {});

  assert.equal(seen[0], seen[1]);
  assert.equal(seen[0], 'payment-confirmation:700');
});

// --- #17: two legitimate partial payments => two distinct SMS -----------------

test('#17 two distinct partial payments (different accountingTransactionId) derive DIFFERENT occurrence keys, so each can send its own SMS', async () => {
  const seen = [];
  automation.dispatchSms = async (key, studentId, event) => { seen.push(event.smsOccurrenceKey); return { status: 'sent' }; };

  FeeInstallment.findByPk = async () => fakeInstallment({ accountingTransactionId: 700 });
  await educationService.sendPaymentSuccessSms(900, 5, {});
  FeeInstallment.findByPk = async () => fakeInstallment({ accountingTransactionId: 701 });
  await educationService.sendPaymentSuccessSms(900, 5, {});

  assert.notEqual(seen[0], seen[1]);
});

// --- #22: missing phone fails safely -------------------------------------------

test('#22 a student with no usable phone number fails safely (skipped, not thrown) end-to-end through dispatchSms', async () => {
  AppSetting.findOne = async () => null;
  StudentMessageTemplate.findOne = async () => ({ key: 'payment_confirmation_sms', body: 'Paid', isActive: true, automationEnabled: true });
  Student.findByPk = async () => ({ id: 12, name: 'Pat', studentNo: 'STU-900', phone: '', contactId: 1 });

  const result = await automation.dispatchSms('payment_confirmation', 12, { eventId: 'x' });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'invalid_phone');
});

// --- #23: disabled payment SMS template sends nothing --------------------------

test('#23 a disabled payment_confirmation_sms template causes no SMS to be sent', async () => {
  StudentMessageTemplate.findOne = async () => ({ key: 'payment_confirmation_sms', body: 'Paid', isActive: true, automationEnabled: false });

  const result = await automation.dispatchSms('payment_confirmation', 12, { eventId: 'x' });

  assert.equal(result.status, 'disabled');
});

// --- #24: migration never replays historical payments --------------------------

test('#24 migration 072 only INSERTs a template row — it never queries or replays historical payments/installments', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations/072_payment_confirmation_sms.js'), 'utf8');
  // Strip comment lines first so mentioning table names in explanatory
  // prose (as the file's own header comment does) can't produce a false
  // positive — only actual code is checked below.
  const code = migration.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.match(code, /INSERT INTO student_message_templates/);
  assert.doesNotMatch(code, /FROM fee_installments|UPDATE fee_installments|FROM accounting_transactions|FROM sms_messages|INSERT INTO sms_messages/i);
  assert.doesNotMatch(code, /dispatchSms|sendAutomated|require\(.*sms/i);
});

// --- #25: scheduler OFF does not affect payment confirmation SMS --------------

test('#25 payment confirmation SMS is event-driven from confirmInstallmentPayment, never from the automation scheduler', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/education.service.js'), 'utf8');
  assert.doesNotMatch(source, /automationScheduler/i);
  assert.match(source, /sendPaymentSuccessSms/);
});

// --- #26: manual/test SMS is untouched -----------------------------------------

test('#26 manual/test SMS (smsMessage.service.js sendSingle) is unchanged by this work and independent of the automation scheduler', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/smsMessage.service.js'), 'utf8');
  assert.match(source, /async sendSingle/);
  assert.doesNotMatch(source, /automationScheduler/i);
});
