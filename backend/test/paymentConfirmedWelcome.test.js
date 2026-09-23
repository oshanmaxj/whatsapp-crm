const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  sequelize, FeeInstallment, StudentFee, Student, AccountingTransaction, StudentAutomationDispatch
} = require('../src/models');
const educationService = require('../src/services/education.service');
const automation = require('../src/services/studentMessageAutomation.service');
const paymentReceiptSettingsService = require('../src/services/paymentReceiptSettings.service');
const commissionService = require('../src/services/commission.service');

const originals = {
  sequelizeTransaction: sequelize.transaction,
  installmentFindByPk: FeeInstallment.findByPk,
  studentFeeFindByPk: StudentFee.findByPk,
  studentFindByPk: Student.findByPk,
  accountingTransactionFindByPk: AccountingTransaction.findByPk,
  receiptSettingsGet: paymentReceiptSettingsService.get,
  sendPaymentSuccessMessage: educationService.sendPaymentSuccessMessage,
  sendPaymentSuccessSms: educationService.sendPaymentSuccessSms,
  sendPaymentConfirmedWelcome: educationService.sendPaymentConfirmedWelcome,
  generateForInstallment: commissionService.generateForInstallment,
  getFee: educationService.getFee,
  claimPaymentWelcome: automation.claimPaymentWelcome,
  dispatch: automation.dispatch,
  dispatchSms: automation.dispatchSms,
  findOrCreate: StudentAutomationDispatch.findOrCreate,
  findOne: StudentAutomationDispatch.findOne
};

test.afterEach(() => {
  sequelize.transaction = originals.sequelizeTransaction;
  FeeInstallment.findByPk = originals.installmentFindByPk;
  StudentFee.findByPk = originals.studentFeeFindByPk;
  Student.findByPk = originals.studentFindByPk;
  AccountingTransaction.findByPk = originals.accountingTransactionFindByPk;
  paymentReceiptSettingsService.get = originals.receiptSettingsGet;
  educationService.sendPaymentSuccessMessage = originals.sendPaymentSuccessMessage;
  educationService.sendPaymentSuccessSms = originals.sendPaymentSuccessSms;
  educationService.sendPaymentConfirmedWelcome = originals.sendPaymentConfirmedWelcome;
  commissionService.generateForInstallment = originals.generateForInstallment;
  educationService.getFee = originals.getFee;
  automation.claimPaymentWelcome = originals.claimPaymentWelcome;
  automation.dispatch = originals.dispatch;
  automation.dispatchSms = originals.dispatchSms;
  StudentAutomationDispatch.findOrCreate = originals.findOrCreate;
  StudentAutomationDispatch.findOne = originals.findOne;
});

// --- structural: registration no longer triggers the automatic welcome -----

test('createStudent() no longer dispatches student_welcome (WhatsApp) or student_welcome SMS at registration time; enrollment welcome and the LMS guide are unaffected', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/education.service.js'), 'utf8');
  const createStudentBody = source.slice(source.indexOf('async createStudent('), source.indexOf('async updateStudent('));
  assert.doesNotMatch(createStudentBody, /dispatch\('student_welcome'/);
  assert.doesNotMatch(createStudentBody, /dispatchSms\('student_welcome'/);
  assert.match(createStudentBody, /dispatchEnrollmentWelcome/);
  assert.match(createStudentBody, /dispatch\('lms_user_guide'/);
});

test('confirmInstallmentPayment() is the only caller of the new payment-confirmed welcome trigger', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/education.service.js'), 'utf8');
  const callSites = source.split('this.sendPaymentConfirmedWelcome(').length - 1;
  assert.equal(callSites, 1);
  const confirmBody = source.slice(source.indexOf('async confirmInstallmentPayment('), source.indexOf('async rejectInstallmentPayment('));
  assert.match(confirmBody, /this\.sendPaymentConfirmedWelcome\(/);
});

// --- sendPaymentConfirmedWelcome(): the new trigger --------------------------

function stubInstallmentWithStudent() {
  const student = { id: 12, name: 'Pat', portalPasswordHash: 'old-hash', update: async function (fields) { Object.assign(this, fields); return this; } };
  const row = { id: 900, fee: { studentId: 12, student } };
  FeeInstallment.findByPk = async (id, options) => {
    assert.ok(options?.include, 'must eagerly include the fee -> student chain (installment is looked up fresh, not carried out of the closed transaction)');
    return row;
  };
  return { row, student };
}

test('the first qualifying payment generates a fresh temporary portal password and sends WhatsApp + SMS welcome with originEvent payment_confirmed', async () => {
  const { student } = stubInstallmentWithStudent();
  automation.claimPaymentWelcome = async () => true;
  let whatsappCall = null;
  automation.dispatch = async (key, studentId, event) => { whatsappCall = { key, studentId, event }; return { status: 'queued' }; };
  let smsCall = null;
  automation.dispatchSms = async (key, studentId, event) => { smsCall = { key, studentId, event }; return { status: 'sent' }; };

  const result = await educationService.sendPaymentConfirmedWelcome(900, 5);

  assert.equal(result.status, 'first_qualifying_payment');
  assert.notEqual(student.portalPasswordHash, 'old-hash');
  assert.match(student.portalPasswordHash, /^Stu-/);
  assert.equal(whatsappCall.key, 'student_welcome');
  assert.equal(whatsappCall.studentId, 12);
  assert.equal(whatsappCall.event.portalPassword, student.portalPasswordHash);
  assert.equal(whatsappCall.event.originEvent, 'payment_confirmed');
  assert.equal(smsCall.key, 'student_welcome');
  assert.equal(smsCall.event.originEvent, 'payment_confirmed');
});

test('a later installment for an already-welcomed student does not regenerate the portal password, and sends no plaintext password to dispatch()', async () => {
  const { student } = stubInstallmentWithStudent();
  const originalHash = student.portalPasswordHash;
  automation.claimPaymentWelcome = async () => false;
  let whatsappPortalPassword = 'unset';
  automation.dispatch = async (key, studentId, event) => { whatsappPortalPassword = event.portalPassword; return { status: 'duplicate' }; };
  automation.dispatchSms = async () => ({ status: 'duplicate' });

  const result = await educationService.sendPaymentConfirmedWelcome(900, 5);

  assert.equal(result.status, 'already_welcomed');
  assert.equal(student.portalPasswordHash, originalHash, 'the password must not be touched on repeat installments');
  assert.equal(whatsappPortalPassword, '');
});

test('sendPaymentConfirmedWelcome() throws when the installment cannot be resolved to a student, so the caller can catch and isolate it', async () => {
  FeeInstallment.findByPk = async () => null;
  await assert.rejects(() => educationService.sendPaymentConfirmedWelcome(999, 5), /Student was not found/);
});

// --- confirmInstallmentPayment(): wiring + failure isolation ------------------

function stubFinancialTransaction({ installmentStatus = 'reversed' } = {}) {
  sequelize.transaction = async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } });
  const installmentRow = {
    id: 900, studentFeeId: 50, accountingTransactionId: 700, status: installmentStatus,
    pendingPaymentAmount: null, paidDate: '2026-04-01', paymentMethod: 'Cash', transactionReference: 'REF-1',
    notes: null, sourceConversationId: null, whatsappAccountId: null
  };
  installmentRow.update = async (fields) => { Object.assign(installmentRow, fields); return installmentRow; };
  FeeInstallment.findByPk = async () => installmentRow;
  StudentFee.findByPk = async () => ({ id: 50, studentId: 12, courseId: null, batchId: null, enrollmentId: null, totalAmount: '1000.00' });
  Student.findByPk = async () => ({ id: 12, name: 'Pat', studentNo: 'STU-900' });
  const accountingTransactionRow = { id: 700, amount: '500.00' };
  accountingTransactionRow.update = async (fields) => { Object.assign(accountingTransactionRow, fields); return accountingTransactionRow; };
  AccountingTransaction.findByPk = async () => accountingTransactionRow;
  paymentReceiptSettingsService.get = async () => ({ autoGenerate: false });
  educationService.getFee = async () => ({ installments: [] });
  educationService.sendPaymentSuccessMessage = async () => ({ status: 'queued' });
  educationService.sendPaymentSuccessSms = async () => ({ status: 'sent' });
  commissionService.generateForInstallment = async () => [{ id: 1 }];
  return installmentRow;
}

test('confirmInstallmentPayment() calls the welcome trigger after commission generation and isolates a welcome failure (payment stays confirmed)', async () => {
  stubFinancialTransaction();
  let welcomeCalledWith = null;
  educationService.sendPaymentConfirmedWelcome = async (installmentId, userId) => {
    welcomeCalledWith = { installmentId, userId };
    throw new Error('welcome provider unavailable');
  };

  const result = await educationService.confirmInstallmentPayment(900, 5);

  assert.deepEqual(welcomeCalledWith, { installmentId: 900, userId: 5 });
  assert.equal(result.welcome.status, 'failed');
  assert.match(result.welcome.warning, /welcome provider unavailable/);
  assert.equal(result.message, 'Payment confirmed and income recorded.');
});

test('confirmInstallmentPayment() exposes the successful welcome result on the response', async () => {
  stubFinancialTransaction();
  educationService.sendPaymentConfirmedWelcome = async () => ({ status: 'first_qualifying_payment', whatsapp: { status: 'queued' }, sms: { status: 'sent' } });

  const result = await educationService.confirmInstallmentPayment(900, 5);

  assert.equal(result.welcome.status, 'first_qualifying_payment');
});

test('confirmInstallmentPayment() skips the welcome trigger entirely when the installment was already confirmed (retry/duplicate confirm)', async () => {
  stubFinancialTransaction({ installmentStatus: 'confirmed' });
  let welcomeCalled = false;
  educationService.sendPaymentConfirmedWelcome = async () => { welcomeCalled = true; return { status: 'first_qualifying_payment' }; };

  const result = await educationService.confirmInstallmentPayment(900, 5);

  assert.equal(welcomeCalled, false, 'a retried/duplicate confirmation of an already-confirmed installment must never attempt the welcome again');
  assert.equal(result.welcome.status, 'skipped');
  assert.equal(result.welcome.reason, 'already_confirmed');
});

// --- claimPaymentWelcome() / hasDispatched(): the atomic per-student claim ---

test('claimPaymentWelcome() claims via a unique, student-scoped dedupeKey using findOrCreate on StudentAutomationDispatch — the same durable table student_welcome itself dedupes on', async () => {
  let capturedWhere = null;
  let capturedDefaults = null;
  StudentAutomationDispatch.findOrCreate = async ({ where, defaults }) => {
    capturedWhere = where; capturedDefaults = defaults;
    return [{ id: 1 }, true];
  };

  const claimed = await automation.claimPaymentWelcome(77);

  assert.equal(claimed, true);
  assert.equal(capturedDefaults.templateKey, 'payment_welcome_claim');
  assert.equal(capturedDefaults.studentId, 77);
  assert.equal(capturedDefaults.dedupeKey, capturedWhere.dedupeKey);
});

test('claimPaymentWelcome() returns false when a claim for this student already exists — this is the property that makes concurrent confirmations safe', async () => {
  StudentAutomationDispatch.findOrCreate = async () => [{ id: 1 }, false];
  assert.equal(await automation.claimPaymentWelcome(77), false);
});

test('two different students never share a claim (dedupeKey is scoped to studentId)', async () => {
  const seen = [];
  StudentAutomationDispatch.findOrCreate = async ({ where }) => { seen.push(where.dedupeKey); return [{ id: 1 }, true]; };
  await automation.claimPaymentWelcome(1);
  await automation.claimPaymentWelcome(2);
  assert.notEqual(seen[0], seen[1]);
});

test('hasDispatched() reports whether a real dispatch row exists for a template/student pair', async () => {
  StudentAutomationDispatch.findOne = async ({ where }) => (where.studentId === 5 ? { id: 1 } : null);
  assert.equal(await automation.hasDispatched('student_welcome', 5), true);
  assert.equal(await automation.hasDispatched('student_welcome', 6), false);
});
