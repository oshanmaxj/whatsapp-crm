const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sequelize, FeeInstallment, StudentFee, Student, AccountingTransaction
} = require('../src/models');
const educationService = require('../src/services/education.service');
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
  generateForInstallment: commissionService.generateForInstallment,
  getFee: educationService.getFee
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
  commissionService.generateForInstallment = originals.generateForInstallment;
  educationService.getFee = originals.getFee;
});

// Exercises confirmInstallmentPayment's "installment already carries an
// accountingTransactionId" branch (existing code path, e.g. a redo/repair
// re-confirm) — the smallest realistic path through the real financial
// transaction, so these tests are wired against the ACTUAL orchestration
// code in education.service.js, not a re-implementation of it.
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
  return installmentRow;
}

// --- #4/#5: WhatsApp ambiguity/failure does not block or poison commission --

test('#4/#5 a WhatsApp send failure (e.g. WHATSAPP_ACCOUNT_AMBIGUOUS) does not poison the DB transaction or block commission generation', async () => {
  stubFinancialTransaction();
  educationService.sendPaymentSuccessMessage = async () => {
    throw Object.assign(new Error('WhatsApp account is required because this contact does not have one unambiguous active account.'), { code: 'WHATSAPP_ACCOUNT_AMBIGUOUS' });
  };
  let smsCalled = false;
  educationService.sendPaymentSuccessSms = async () => { smsCalled = true; return { status: 'sent' }; };
  let commissionCalled = false;
  commissionService.generateForInstallment = async () => { commissionCalled = true; return [{ id: 1 }]; };

  const result = await educationService.confirmInstallmentPayment(900, 5);

  assert.equal(result.notification.status, 'failed');
  assert.match(result.notification.warning, /WHATSAPP_ACCOUNT_AMBIGUOUS|unambiguous active account/);
  assert.equal(smsCalled, true, 'SMS must still be attempted after a WhatsApp failure');
  assert.equal(commissionCalled, true, 'commission generation must still run after a WhatsApp failure');
  assert.equal(result.message, 'Payment confirmed and income recorded.');
});

// --- #6: SMS failure does not block commission --------------------------------

test('#6 an SMS failure does not block commission generation', async () => {
  stubFinancialTransaction();
  educationService.sendPaymentSuccessMessage = async () => ({ status: 'queued' });
  educationService.sendPaymentSuccessSms = async () => { throw new Error('SMS gateway disabled'); };
  let commissionCalled = false;
  commissionService.generateForInstallment = async () => { commissionCalled = true; return [{ id: 1 }]; };

  const result = await educationService.confirmInstallmentPayment(900, 5);

  assert.equal(result.smsNotification.status, 'failed');
  assert.equal(commissionCalled, true);
});

// --- #7: commission failure does not roll back the already-recorded payment --

test('#7 a commission generation failure does not roll back or affect the already-recorded payment', async () => {
  const installmentRow = stubFinancialTransaction();
  educationService.sendPaymentSuccessMessage = async () => ({ status: 'queued' });
  educationService.sendPaymentSuccessSms = async () => ({ status: 'sent' });
  commissionService.generateForInstallment = async () => { throw new Error('current transaction is aborted, commands ignored until end of transaction block'); };

  const result = await educationService.confirmInstallmentPayment(900, 5);

  assert.equal(installmentRow.status, 'confirmed', 'the installment status change must already be committed, independent of commission outcome');
  assert.equal(result.message, 'Payment confirmed and income recorded.');
  assert.equal(result.accountingTransactionId, 700);
});

// --- receipt generation failure does not block WhatsApp/SMS/commission ------

test('a payment receipt generation failure does not block WhatsApp, SMS, or commission (the pre-fix bug: this call was not wrapped in try/catch)', async () => {
  stubFinancialTransaction();
  paymentReceiptSettingsService.get = async () => ({ autoGenerate: true });
  const paymentReceiptService = require('../src/services/paymentReceipt.service');
  const originalGenerate = paymentReceiptService.generatePaymentReceipt;
  paymentReceiptService.generatePaymentReceipt = async () => { throw new Error('RECEIPT_STUDENT_AMBIGUOUS'); };
  let whatsappCalled = false, smsCalled = false, commissionCalled = false;
  educationService.sendPaymentSuccessMessage = async () => { whatsappCalled = true; return { status: 'queued' }; };
  educationService.sendPaymentSuccessSms = async () => { smsCalled = true; return { status: 'sent' }; };
  commissionService.generateForInstallment = async () => { commissionCalled = true; return [{ id: 1 }]; };

  const result = await educationService.confirmInstallmentPayment(900, 5);

  assert.equal(whatsappCalled, true);
  assert.equal(smsCalled, true);
  assert.equal(commissionCalled, true);
  assert.equal(result.receipt, null);
  assert.equal(result.receiptCreated, false);

  paymentReceiptService.generatePaymentReceipt = originalGenerate;
});
