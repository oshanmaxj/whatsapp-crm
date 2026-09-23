const test = require('node:test');
const assert = require('node:assert/strict');
const { Course, Batch } = require('../src/models');
const educationService = require('../src/services/education.service');

const originals = { courseFindByPk: Course.findByPk, batchFindByPk: Batch.findByPk };

test.afterEach(() => {
  Course.findByPk = originals.courseFindByPk;
  Batch.findByPk = originals.batchFindByPk;
});

function stubCourse(course) {
  Course.findByPk = async (id) => (String(id) === String(course.id) ? course : null);
  Batch.findByPk = async () => null;
}

function enrollment(overrides = {}) {
  return {
    courseId: 1, batchId: null, enrollmentStatus: 'active', feePlan: 'full',
    installments: null, discountValue: 0, enrolledAt: new Date(), completedAt: null,
    ...overrides
  };
}

// --- Task 10/12: Course config is the sole source of truth for installments -

test('installment count is always derived from the course default, even when a client sends a different value', async () => {
  stubCourse({ id: 1, feeAmount: '12000.00', defaultInstallmentCount: 2 });
  const rows = [enrollment({ feePlan: 'installment', installments: 9 })];

  await educationService.validateEnrollments(rows);

  assert.equal(rows[0].installments, 2, 'the client-supplied 9 must be ignored — the course default (2) wins');
});

test('full payment plans are always 1 installment regardless of the course default', async () => {
  stubCourse({ id: 1, feeAmount: '12000.00', defaultInstallmentCount: 3 });
  const rows = [enrollment({ feePlan: 'full' })];

  await educationService.validateEnrollments(rows);

  assert.equal(rows[0].installments, 1);
});

test('a course with no valid installment configuration fails clearly instead of silently defaulting to 1', async () => {
  stubCourse({ id: 1, feeAmount: '12000.00', defaultInstallmentCount: 0 });
  const rows = [enrollment({ feePlan: 'installment' })];

  await assert.rejects(
    () => educationService.validateEnrollments(rows),
    (error) => { assert.equal(error.code, 'COURSE_INSTALLMENT_CONFIG_MISSING'); assert.equal(error.status, 422); return true; }
  );
});

test('a course with a non-integer installment default also fails clearly', async () => {
  stubCourse({ id: 1, feeAmount: '12000.00', defaultInstallmentCount: null });
  const rows = [enrollment({ feePlan: 'installment' })];

  await assert.rejects(() => educationService.validateEnrollments(rows), /installment configuration/);
});

// --- Task 13: discount validation ---------------------------------------------

test('discount defaults to 0 when not provided', async () => {
  stubCourse({ id: 1, feeAmount: '12000.00', defaultInstallmentCount: 1 });
  const rows = [enrollment({ discountValue: 0 })];
  await educationService.validateEnrollments(rows);
  assert.equal(rows[0].discountValue, 0);
});

test('a negative discount is rejected, not silently clamped to 0', async () => {
  stubCourse({ id: 1, feeAmount: '12000.00', defaultInstallmentCount: 1 });
  const rows = [enrollment({ discountValue: -500 })];

  await assert.rejects(() => educationService.validateEnrollments(rows), /discount cannot be negative/);
});

test('a discount exceeding the course fee is rejected', async () => {
  stubCourse({ id: 1, feeAmount: '10000.00', defaultInstallmentCount: 1 });
  const rows = [enrollment({ discountValue: 15000 })];

  await assert.rejects(() => educationService.validateEnrollments(rows), /discount cannot exceed the course fee/);
});

test('a discount exactly equal to the course fee is allowed (final payable becomes 0)', async () => {
  stubCourse({ id: 1, feeAmount: '10000.00', defaultInstallmentCount: 1 });
  const rows = [enrollment({ discountValue: 10000 })];
  await educationService.validateEnrollments(rows);
  assert.equal(rows[0].discountValue, 10000);
});

// --- Task 15: multiple enrollments in one registration are independent -------

test('two enrollments for different courses derive independent installment counts and discounts (no cross-contamination)', async () => {
  const courses = {
    1: { id: 1, feeAmount: '12000.00', defaultInstallmentCount: 2 },
    2: { id: 2, feeAmount: '8000.00', defaultInstallmentCount: 4 }
  };
  Course.findByPk = async (id) => courses[id] || null;
  Batch.findByPk = async () => null;
  const rows = [
    enrollment({ courseId: 1, feePlan: 'installment', discountValue: 2000 }),
    enrollment({ courseId: 2, feePlan: 'installment', discountValue: 500, batchId: null })
  ];

  await educationService.validateEnrollments(rows);

  assert.equal(rows[0].installments, 2);
  assert.equal(rows[0].discountValue, 2000);
  assert.equal(rows[1].installments, 4);
  assert.equal(rows[1].discountValue, 500);
});

test('an oversized discount on the SECOND enrollment does not affect the first (each is validated against its own course fee)', async () => {
  const courses = {
    1: { id: 1, feeAmount: '12000.00', defaultInstallmentCount: 1 },
    2: { id: 2, feeAmount: '1000.00', defaultInstallmentCount: 1 }
  };
  Course.findByPk = async (id) => courses[id] || null;
  Batch.findByPk = async () => null;
  const rows = [
    enrollment({ courseId: 1, discountValue: 1000 }),
    enrollment({ courseId: 2, discountValue: 5000 })
  ];

  await assert.rejects(() => educationService.validateEnrollments(rows), /discount cannot exceed the course fee/);
});
