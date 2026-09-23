const test = require('node:test');
const assert = require('node:assert/strict');
const { sequelize, Student, StudentFee, Course, Batch } = require('../src/models');
const educationService = require('../src/services/education.service');

const originals = {
  sequelizeTransaction: sequelize.transaction,
  studentFindByPk: Student.findByPk,
  studentFindAll: Student.findAll,
  studentFindAndCountAll: Student.findAndCountAll,
  studentFeeCreate: StudentFee.create,
  courseFindByPk: Course.findByPk,
  batchFindByPk: Batch.findByPk,
  replaceInstallments: educationService.replaceInstallments
};

test.afterEach(() => {
  sequelize.transaction = originals.sequelizeTransaction;
  Student.findByPk = originals.studentFindByPk;
  Student.findAll = originals.studentFindAll;
  Student.findAndCountAll = originals.studentFindAndCountAll;
  StudentFee.create = originals.studentFeeCreate;
  Course.findByPk = originals.courseFindByPk;
  Batch.findByPk = originals.batchFindByPk;
  educationService.replaceInstallments = originals.replaceInstallments;
});

// --- Task D/E: root cause was the read/edit mapping layer, not CREATE -------
// StudentEnrollment has no discount/feePlan columns of its own; StudentFee
// does. getStudent()/listStudents() previously returned the two as separate,
// unlinked arrays, so re-fetching a student for Edit always showed discount
// 0 and feePlan 'full' regardless of what was actually saved.

function studentWithEnrollmentsAndFees({ enrollments, fees }) {
  return {
    id: 1, name: 'Pat', enrollments, fees,
    toJSON() { return { id: this.id, name: this.name, enrollments: this.enrollments, fees: this.fees }; }
  };
}

test('#7/#8/D/E: fetching a student maps each enrollment\'s discount/fee state from its StudentFee via the stable enrollmentId FK, not array position', async () => {
  Student.findByPk = async () => studentWithEnrollmentsAndFees({
    enrollments: [
      { id: 10, courseId: 1, batchId: null, enrollmentStatus: 'active', course: { id: 1, feeAmount: '0.00' } },
      { id: 11, courseId: 2, batchId: null, enrollmentStatus: 'active', course: { id: 2, feeAmount: '12000.00' } }
    ],
    fees: [
      { id: 100, enrollmentId: 10, courseId: 1, batchId: null, originalAmount: '0.00', discountType: 'none', discountValue: '0.00', discountAmount: '0.00', totalAmount: '0.00', paidAmount: '0.00', balance: '0.00', paymentType: 'full', installmentCount: 1, status: 'paid' },
      { id: 101, enrollmentId: 11, courseId: 2, batchId: null, originalAmount: '12000.00', discountType: 'fixed', discountValue: '2000.00', discountAmount: '2000.00', totalAmount: '10000.00', paidAmount: '0.00', balance: '10000.00', paymentType: 'full', installmentCount: 1, status: 'pending' }
    ]
  });

  const student = await educationService.getStudentForDisplay(1);

  const free = student.enrollments.find((item) => item.id === 10);
  const paid = student.enrollments.find((item) => item.id === 11);
  assert.equal(free.discountValue, 0);
  assert.equal(free.courseFee, 0);
  assert.equal(paid.discountValue, 2000, 'the 2000 discount on enrollment #2 must round-trip back into the edit DTO');
  assert.equal(paid.courseFee, 12000);
  assert.equal(paid.totalAmount, 10000);
  assert.equal(paid.feePlan, 'full');
});

test('#4/F: discounts never leak between enrollments even when array order is reversed or ids are non-sequential', async () => {
  Student.findByPk = async () => studentWithEnrollmentsAndFees({
    enrollments: [
      { id: 55, courseId: 9, batchId: null, enrollmentStatus: 'active', course: { id: 9, feeAmount: '5000.00' } },
      { id: 7, courseId: 3, batchId: null, enrollmentStatus: 'active', course: { id: 3, feeAmount: '8000.00' } }
    ],
    fees: [
      // Deliberately created/stored out of enrollment order.
      { id: 201, enrollmentId: 7, courseId: 3, batchId: null, originalAmount: '8000.00', discountType: 'fixed', discountValue: '500.00', discountAmount: '500.00', totalAmount: '7500.00', paidAmount: '0', balance: '7500.00', paymentType: 'full', installmentCount: 1, status: 'pending' },
      { id: 200, enrollmentId: 55, courseId: 9, batchId: null, originalAmount: '5000.00', discountType: 'fixed', discountValue: '1000.00', discountAmount: '1000.00', totalAmount: '4000.00', paidAmount: '0', balance: '4000.00', paymentType: 'full', installmentCount: 1, status: 'pending' }
    ]
  });

  const student = await educationService.getStudentForDisplay(1);

  assert.equal(student.enrollments.find((item) => item.id === 55).discountValue, 1000);
  assert.equal(student.enrollments.find((item) => item.id === 7).discountValue, 500);
});

test('installment plan round-trips paymentType and installmentCount from the Course-derived fee, not a stale default', async () => {
  Student.findByPk = async () => studentWithEnrollmentsAndFees({
    enrollments: [{ id: 20, courseId: 4, batchId: null, enrollmentStatus: 'active', course: { id: 4, feeAmount: '12000.00', defaultInstallmentCount: 2 } }],
    fees: [{ id: 300, enrollmentId: 20, courseId: 4, batchId: null, originalAmount: '12000.00', discountType: 'fixed', discountValue: '2000.00', discountAmount: '2000.00', totalAmount: '10000.00', paidAmount: '0', balance: '10000.00', paymentType: 'installment', installmentCount: 2, status: 'pending' }]
  });

  const student = await educationService.getStudentForDisplay(1);
  const enrollment = student.enrollments[0];
  assert.equal(enrollment.feePlan, 'installment');
  assert.equal(enrollment.installmentCount, 2);
  assert.equal(enrollment.discountValue, 2000);
});

test('legacy StudentFee rows with no enrollmentId still map by courseId+batchId (pre-existing data, not a new bug)', async () => {
  Student.findByPk = async () => studentWithEnrollmentsAndFees({
    enrollments: [{ id: 30, courseId: 6, batchId: null, enrollmentStatus: 'active', course: { id: 6, feeAmount: '9000.00' } }],
    fees: [{ id: 400, enrollmentId: null, courseId: 6, batchId: null, originalAmount: '9000.00', discountType: 'none', discountValue: '0', discountAmount: '0', totalAmount: '9000.00', paidAmount: '0', balance: '9000.00', paymentType: 'full', installmentCount: 1, status: 'pending' }]
  });

  const student = await educationService.getStudentForDisplay(1);
  assert.equal(student.enrollments[0].feeId, 400);
});

test('#9/L: unrelated fields on an enrollment (no matching fee at all) never borrow another enrollment\'s fee', async () => {
  Student.findByPk = async () => studentWithEnrollmentsAndFees({
    enrollments: [
      { id: 40, courseId: 1, batchId: null, enrollmentStatus: 'active', course: { id: 1, feeAmount: '5000.00' } },
      { id: 41, courseId: 2, batchId: null, enrollmentStatus: 'cancelled', course: { id: 2, feeAmount: '6000.00' } }
    ],
    fees: [{ id: 500, enrollmentId: 40, courseId: 1, batchId: null, originalAmount: '5000.00', discountType: 'none', discountValue: '0', discountAmount: '0', totalAmount: '5000.00', paidAmount: '0', balance: '5000.00', paymentType: 'full', installmentCount: 1, status: 'pending' }]
  });

  const student = await educationService.getStudentForDisplay(1);
  const noFee = student.enrollments.find((item) => item.id === 41);
  assert.equal(noFee.discountValue, 0);
  assert.equal(noFee.feeId, null, 'an enrollment with no fee of its own must never inherit a sibling enrollment\'s fee id');
  assert.equal(noFee.courseFee, 6000, 'falls back to its OWN course\'s configured fee, not the other enrollment\'s');
});

// --- Task 9/10: unrelated student edits never touch StudentFee -------------

test('#9/#10/L updateStudent() (name/phone/notes edit, no enrollments key in payload) never calls syncEnrollments or touches any fee', async () => {
  sequelize.transaction = async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } });
  const row = { id: 1, contactId: 2, leadId: null, update: async function (fields) { Object.assign(this, fields); return this; } };
  Student.findByPk = async () => row;
  const originalSync = educationService.syncEnrollments;
  let syncCalled = false;
  educationService.syncEnrollments = async () => { syncCalled = true; };
  const identity = require('../src/services/studentCanonicalIdentity.service');
  const originalIdentitySync = identity.sync;
  const originalPublish = identity.publish;
  identity.sync = async () => ({ ok: true });
  identity.publish = async () => {};
  educationService.getStudentForDisplay = async (id) => ({ id, enrollments: [] });

  try {
    await educationService.updateStudent(1, { name: 'New Name', phone: '0771234567', notes: 'updated' }, 9);
    assert.equal(syncCalled, false, 'a payload without an "enrollments" key must never invoke syncEnrollments, let alone touch fees');
  } finally {
    educationService.syncEnrollments = originalSync;
    identity.sync = originalIdentitySync;
    identity.publish = originalPublish;
  }
});

test('syncEnrollments() only ever updates StudentEnrollment columns — structurally cannot delete/recreate a StudentFee', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/education.service.js'), 'utf8');
  const body = source.slice(source.indexOf('async syncEnrollments('), source.indexOf('async listStudentEnrollments('));
  assert.doesNotMatch(body, /StudentFee/, 'syncEnrollments must never reference StudentFee at all');
  assert.doesNotMatch(body, /FeeInstallment/);
});

// --- Task 13/14/15/I/J: zero-fee vs 100%-discounted courses -----------------

test('#13/#14/I a naturally-free course (Course feeAmount=0) creates a StudentFee (for LMS access) but NO installment rows', async () => {
  Course.findByPk = async () => ({ id: 1, feeAmount: '0.00', defaultInstallmentCount: 1 });
  Batch.findByPk = async () => null;
  Student.findByPk = async () => ({
    id: 1, enrollments: [{ id: 10, courseId: 1, batchId: null, enrollmentStatus: 'active' }], studentNo: 'STU-1',
    update: async function (fields) { Object.assign(this, fields); return this; }
  });
  let created = null;
  StudentFee.create = async (data) => { created = { id: 900, ...data }; return created; };
  let replaceInstallmentsCalled = false;
  educationService.replaceInstallments = async () => { replaceInstallmentsCalled = true; };
  const originalGetFee = educationService.getFee;
  educationService.getFee = async () => ({ id: 900, installments: [] });

  try {
    const result = await educationService.createFee({ studentId: 1, enrollmentId: 10, courseId: 1, paymentType: 'full' });
    assert.equal(created.originalAmount, 0);
    assert.equal(replaceInstallmentsCalled, false, 'no installment rows should be created for a naturally-free course');
    assert.ok(result.fee);
  } finally {
    educationService.getFee = originalGetFee;
  }
});

test('#15/J a 100%-discounted PAID course (Course fee 12000, discount 12000) still creates its installment — it is NOT treated as naturally free', async () => {
  Course.findByPk = async () => ({ id: 2, feeAmount: '12000.00', defaultInstallmentCount: 1 });
  Batch.findByPk = async () => null;
  Student.findByPk = async () => ({
    id: 1, enrollments: [{ id: 11, courseId: 2, batchId: null, enrollmentStatus: 'active' }], studentNo: 'STU-1',
    update: async function (fields) { Object.assign(this, fields); return this; }
  });
  let created = null;
  StudentFee.create = async (data) => { created = { id: 901, ...data }; return created; };
  let replaceInstallmentsCalled = false;
  educationService.replaceInstallments = async () => { replaceInstallmentsCalled = true; };
  const originalGetFee = educationService.getFee;
  educationService.getFee = async () => ({ id: 901, installments: [] });

  try {
    await educationService.createFee({ studentId: 1, enrollmentId: 11, courseId: 2, paymentType: 'full', discountType: 'fixed', discountValue: 12000 });
    assert.equal(created.originalAmount, 12000, 'the base course fee must be preserved for audit even though it is now fully waived');
    assert.equal(created.discountAmount, 12000);
    assert.equal(created.totalAmount, 0);
    assert.equal(replaceInstallmentsCalled, true, 'a real course fee discounted to 0 keeps its installment for auditability — this is a financial concession, not a free course');
  } finally {
    educationService.getFee = originalGetFee;
  }
});

// --- Task 11/12: Fees list excludes naturally-free, keeps 100%-discounted --

test('#11/#12 listFees() excludes naturally-free (originalAmount=0) records by default', async () => {
  let capturedWhere = null;
  Student.findAndCountAll = async () => ({ rows: [], count: 0 });
  const { Op } = require('sequelize');
  const originalFindAll = StudentFee.findAll;
  StudentFee.findAll = async (options) => { capturedWhere = options.where; return []; };
  const originalMarkOverdue = educationService.markOverdue;
  educationService.markOverdue = async () => {};

  try {
    await educationService.listFees({});
    assert.deepEqual(capturedWhere.originalAmount, { [Op.gt]: 0 });
  } finally {
    StudentFee.findAll = originalFindAll;
    educationService.markOverdue = originalMarkOverdue;
  }
});

// --- Task 16/17/M: welcome timing is untouched by this fix ------------------

test('#16/#17/M createStudent() still never dispatches student_welcome at registration, and confirmInstallmentPayment() is still the only caller of the payment-confirmed welcome trigger', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/education.service.js'), 'utf8');
  const createStudentBody = source.slice(source.indexOf('async createStudent('), source.indexOf('async updateStudent('));
  assert.doesNotMatch(createStudentBody, /dispatch\('student_welcome'/);
  assert.doesNotMatch(createStudentBody, /dispatchSms\('student_welcome'/);
  const callSites = source.split('this.sendPaymentConfirmedWelcome(').length - 1;
  assert.equal(callSites, 1);
});

// --- Task 20: multi-enrollment payload independence (frontend service) -----

test('#20 the frontend education.service.js normalizer keeps each enrollment\'s own discountValue independent', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend/src/services/education.service.js'), 'utf8');
  assert.match(src, /discountValue/);
  // Structural guard: the normalizer must map over each row independently
  // (per-row closure), never reduce/reference a single shared discount
  // value across the whole array.
  const fn = src.slice(src.indexOf('const normalizeEnrollment ='), src.indexOf('const normalizeStudentPayload ='));
  assert.match(fn, /row\.discountValue/);
  assert.doesNotMatch(fn, /enrollments\[0\]|enrollments\[i\s*-\s*1\]/);
});
