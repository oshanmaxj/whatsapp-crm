const test = require('node:test');
const assert = require('node:assert/strict');
const models = require('../src/models');
const service = require('../src/services/paymentSlip.service');

const originals = {
  student: models.Student.findByPk,
  fees: models.StudentFee.findAll,
  fee: models.StudentFee.findByPk,
  enrollments: models.StudentEnrollment.findAll,
  installments: models.FeeInstallment.findAll
};

test.afterEach(() => {
  models.Student.findByPk = originals.student;
  models.StudentFee.findAll = originals.fees;
  models.StudentFee.findByPk = originals.fee;
  models.StudentEnrollment.findAll = originals.enrollments;
  models.FeeInstallment.findAll = originals.installments;
});

function mockStudentFees(fees) {
  models.Student.findByPk = async () => ({ id: 4, studentNo: 'STU-000004', name: 'Test Student' });
  models.StudentFee.findAll = async () => fees;
  models.StudentEnrollment.findAll = async () => [];
}

test('one active fee is auto-selected', async () => {
  mockStudentFees([{ id: 10, totalAmount: 5000, paidAmount: 1000, balance: 4000, status: 'partial', course: { name: 'English' } }]);
  const result = await service.feeOptions(4);
  assert.equal(result.autoSelectId, 10);
  assert.equal(result.options[0].remainingBalance, 4000);
});

test('multiple active fees require staff selection', async () => {
  mockStudentFees([
    { id: 10, totalAmount: 5000, paidAmount: 0, balance: 5000, status: 'pending', course: { name: 'English' } },
    { id: 11, totalAmount: 7000, paidAmount: 1000, balance: 6000, status: 'partial', course: { name: 'IT' } }
  ]);
  const result = await service.feeOptions(4);
  assert.equal(result.autoSelectId, null);
  assert.equal(result.options.length, 2);
});

test('fully paid fees are excluded even when returned by a stale query', async () => {
  mockStudentFees([{ id: 10, totalAmount: 5000, paidAmount: 5000, balance: 0, status: 'paid', course: { name: 'English' } }]);
  const result = await service.feeOptions(4);
  assert.deepEqual(result.options, []);
  assert.equal(result.autoSelectId, null);
});

test('no fee state returns enrollment choices for authorized plan creation', async () => {
  mockStudentFees([]);
  models.StudentEnrollment.findAll = async () => [{ id: 3, course: { name: 'English', feeAmount: 5000, defaultInstallmentCount: 2 } }];
  const result = await service.feeOptions(4);
  assert.equal(result.options.length, 0);
  assert.deepEqual(result.enrollments[0], { id: 3, courseName: 'English', courseFee: 5000, defaultInstallmentCount: 2 });
});

test('partially paid installment remains selectable and fills its remaining amount', async () => {
  models.StudentFee.findByPk = async () => ({ id: 10, studentId: 4, status: 'partial', balance: 750 });
  models.FeeInstallment.findAll = async () => [{ id: 8, installmentNo: 2, amount: 2000, paidAmount: 1250, dueDate: '2026-08-01', status: 'partially_paid' }];
  const result = await service.outstandingInstallmentOptions(10);
  assert.equal(result.autoSelectId, 8);
  assert.equal(result.options[0].remainingBalance, 750);
  assert.equal(result.suggestedConfirmedAmount, 750);
});

test('no outstanding installment returns an explicit empty option set', async () => {
  models.StudentFee.findByPk = async () => ({ id: 10, studentId: 4, status: 'pending', balance: 5000 });
  models.FeeInstallment.findAll = async () => [];
  const result = await service.outstandingInstallmentOptions(10);
  assert.deepEqual(result.options, []);
  assert.equal(result.autoSelectId, null);
  assert.equal(result.suggestedConfirmedAmount, null);
});
