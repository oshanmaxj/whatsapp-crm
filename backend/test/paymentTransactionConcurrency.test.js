const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  sequelize, Student, Course, Batch, StudentEnrollment, StudentFee, User,
  AccountingTransaction, PaymentReceipt, FeeInstallment
} = require('../src/models');
const educationService = require('../src/services/education.service');
const paymentReceiptService = require('../src/services/paymentReceipt.service');
const paymentReceiptSettingsService = require('../src/services/paymentReceiptSettings.service');
const numberService = require('../src/services/paymentReceiptNumber.service');
const tokenCrypto = require('../src/services/paymentReceiptCrypto.service');
const auditService = require('../src/services/audit.service');

// A deterministic stand-in for a real Postgres connection/transaction: it
// detects when a SECOND query starts on the same `transaction` marker
// before the FIRST one has finished — exactly the pattern that produces
// pg's "Calling client.query() when the client is already executing a
// query is deprecated" warning, and which corrupted a pooled connection
// badly enough that a LATER, unrelated transaction (commission generation)
// inherited "current transaction is aborted" from it. This is what "no
// concurrent queries on the same transaction connection" is actually
// testing, without needing a live Postgres instance (unavailable in this
// environment).
function makeConcurrencyGuard() {
  const busy = new Set();
  const violations = [];
  function query(resolveWith, delayMs = 4) {
    return async (idOrOpts, maybeOpts) => {
      const transaction = (maybeOpts || idOrOpts)?.transaction;
      if (busy.has(transaction)) violations.push(new Error('concurrent query on the same transaction').stack);
      busy.add(transaction);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      busy.delete(transaction);
      return resolveWith;
    };
  }
  return { violations, query };
}

const originals = {
  studentFindByPk: Student.findByPk,
  courseFindByPk: Course.findByPk,
  batchFindByPk: Batch.findByPk,
  enrollmentFindByPk: StudentEnrollment.findByPk,
  studentFeeFindByPk: StudentFee.findByPk,
  userFindByPk: User.findByPk,
  accountingTransactionFindByPk: AccountingTransaction.findByPk,
  sequelizeTransaction: sequelize.transaction,
  sequelizeGetDialect: sequelize.getDialect,
  paymentReceiptFindOne: PaymentReceipt.findOne,
  paymentReceiptCreate: PaymentReceipt.create,
  feeInstallmentFindOne: FeeInstallment.findOne,
  receiptSettingsGet: paymentReceiptSettingsService.get,
  numberNext: numberService.next,
  createToken: tokenCrypto.createToken,
  hashToken: tokenCrypto.hashToken,
  encryptToken: tokenCrypto.encryptToken,
  auditRecord: auditService.record
};

test.afterEach(() => {
  Student.findByPk = originals.studentFindByPk;
  Course.findByPk = originals.courseFindByPk;
  Batch.findByPk = originals.batchFindByPk;
  StudentEnrollment.findByPk = originals.enrollmentFindByPk;
  StudentFee.findByPk = originals.studentFeeFindByPk;
  User.findByPk = originals.userFindByPk;
  AccountingTransaction.findByPk = originals.accountingTransactionFindByPk;
  sequelize.transaction = originals.sequelizeTransaction;
  sequelize.getDialect = originals.sequelizeGetDialect;
  PaymentReceipt.findOne = originals.paymentReceiptFindOne;
  PaymentReceipt.create = originals.paymentReceiptCreate;
  FeeInstallment.findOne = originals.feeInstallmentFindOne;
  paymentReceiptSettingsService.get = originals.receiptSettingsGet;
  numberService.next = originals.numberNext;
  tokenCrypto.createToken = originals.createToken;
  tokenCrypto.hashToken = originals.hashToken;
  tokenCrypto.encryptToken = originals.encryptToken;
  auditService.record = originals.auditRecord;
});

// --- sanity check: the guard itself actually detects the old bug pattern ----

test('sanity: the concurrency guard DOES flag a violation for a Promise.all sharing one transaction (proves the guard would have caught the original bug)', async () => {
  const guard = makeConcurrencyGuard();
  const tx = {};
  await Promise.all([
    guard.query('a')(1, { transaction: tx }),
    guard.query('b')(1, { transaction: tx }),
    guard.query('c')(1, { transaction: tx })
  ]);
  assert.ok(guard.violations.length > 0, 'Promise.all against one transaction must be detected as a violation');
});

test('sanity: the concurrency guard reports NO violation for sequential awaits on one transaction', async () => {
  const guard = makeConcurrencyGuard();
  const tx = {};
  await guard.query('a')(1, { transaction: tx });
  await guard.query('b')(1, { transaction: tx });
  await guard.query('c')(1, { transaction: tx });
  assert.equal(guard.violations.length, 0);
});

// --- the real fix: accountingPaymentContext no longer issues concurrent
// queries on the shared payment-confirmation transaction ---------------------

test('accountingPaymentContext() issues Student/Course/Batch/StudentEnrollment lookups SEQUENTIALLY on the shared transaction, never concurrently', async () => {
  const guard = makeConcurrencyGuard();
  const tx = { name: 'financial-tx' };
  StudentFee.findByPk = async () => ({ studentId: 1, courseId: 2, batchId: 3, enrollmentId: 4 });
  Student.findByPk = guard.query({ name: 'Stu', studentNo: 'STU-1' });
  Course.findByPk = guard.query({ name: 'Course' });
  Batch.findByPk = guard.query({ name: 'Batch' });
  StudentEnrollment.findByPk = guard.query({ id: 4 });

  const context = await educationService.accountingPaymentContext(99, tx);

  assert.equal(guard.violations.length, 0, guard.violations.join('\n'));
  assert.equal(context.student.name, 'Stu');
  assert.equal(context.course.name, 'Course');
  assert.equal(context.batch.name, 'Batch');
});

// --- the real fix: paymentReceipt.service.js run() is also sequential now ---

test('generatePaymentReceipt\'s internal Course/Batch/User lookups run SEQUENTIALLY on the shared transaction, never concurrently', async () => {
  const guard = makeConcurrencyGuard();

  sequelize.getDialect = () => 'sqlite'; // skips the pg_advisory_xact_lock branch, irrelevant to this test
  sequelize.transaction = async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } });
  AccountingTransaction.findByPk = async () => ({
    id: 1, type: 'income', amount: '500.00', date: '2026-04-01', paymentMethod: 'Cash',
    referenceNo: 'REF', sourceConversationId: null, whatsappAccountId: null, relatedStudentId: 1, relatedCourseId: null
  });
  PaymentReceipt.findOne = async () => null;
  FeeInstallment.findOne = async () => null;
  StudentFee.findByPk = async () => null;
  Student.findByPk = guard.query({ id: 1, name: 'Stu', studentNo: 'STU-1', phone: '0771234567', courseId: null, batchId: null });
  Course.findByPk = guard.query({ name: 'Course' });
  Batch.findByPk = guard.query({ name: 'Batch' });
  User.findByPk = guard.query({ firstName: 'A', lastName: 'B' });
  paymentReceiptSettingsService.get = async () => ({ currency: 'LKR' });
  numberService.next = async () => 'RCPT-0001';
  tokenCrypto.createToken = () => 'token';
  tokenCrypto.hashToken = () => 'hash';
  tokenCrypto.encryptToken = () => 'enc';
  auditService.record = async () => {};
  PaymentReceipt.create = async (data) => ({ ...data, id: 1 });

  await paymentReceiptService.generatePaymentReceipt({ paymentId: 1, actorType: 'USER', generationSource: 'MANUAL_PAYMENT', generatePdf: false });

  assert.equal(guard.violations.length, 0, guard.violations.join('\n'));
});

// --- structural guard: no Promise.all shares `transaction` anywhere in the
// payment confirmation / receipt / commission code path any more ------------

test('no Promise.all in the payment-confirmation/receipt/commission code path passes the same `transaction` to more than one call', () => {
  const files = [
    'src/services/education.service.js',
    'src/services/paymentReceipt.service.js',
    'src/services/commissionLedger.service.js',
    'src/services/commissionCalculation.service.js',
    'src/services/commissionRule.service.js',
    'src/services/lecturerAgreement.service.js'
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const matches = source.match(/Promise\.all\(\[[\s\S]*?\]\)/g) || [];
    for (const block of matches) {
      const transactionMentions = (block.match(/\btransaction\b/g) || []).length;
      assert.ok(transactionMentions <= 1, `${file} still has a Promise.all sharing \`transaction\` across multiple calls:\n${block}`);
    }
  }
});
