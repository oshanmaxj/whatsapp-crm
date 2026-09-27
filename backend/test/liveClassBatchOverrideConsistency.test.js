const test = require('node:test');
const assert = require('node:assert/strict');

const models = require('../src/models');
const studentPortal = require('../src/services/studentPortal.service');

function record(values) {
  return {
    ...values,
    async update(changes) { Object.assign(this, changes); return this; },
    toJSON() { return { ...this }; }
  };
}

// Reproduces the reported bug: a student can see an enabled "Join Live Class"
// button (dashboard/lessons/live-classes list, or the single-lesson page) but
// clicking it fails. Root cause: LmsLessonBatchOverride (a per-batch
// schedule/link override on top of a shared LmsLesson row) was applied by
// joinLiveClass() at join time, but NOT by lessons()/lesson() when computing
// the canJoin/classStatus the button itself is rendered from. Any lesson with
// a batch-specific override therefore showed a button computed from the
// wrong (base) schedule for students in that batch.
test('lessons() and joinLiveClass() agree when a batch override blocks the class', async () => {
  const now = Date.now();
  const student = { id: 501 };
  const enrollment = record({
    id: 301, studentId: 501, courseId: 77, batchId: 9, enrollmentStatus: 'active',
    enrolledAt: new Date(), course: { id: 77, name: 'Course' }, batch: { id: 9, name: 'Evening Batch' }
  });
  // Base lesson: shared across every batch (batchId: null), and — taken on
  // its own — perfectly joinable (future start time, real zoom link).
  const baseLesson = record({
    id: 900, courseId: 77, batchId: null, lessonOrder: 1, title: 'Live Class 1',
    status: 'published', isPublished: true,
    liveClassAt: new Date(now + 5 * 60000), zoomLink: 'https://zoom.example/j/BASE',
    allowJoinBeforeMinutes: 30, allowJoinAfterMinutes: 150, durationMinutes: 60,
    progress: [], materials: [], comments: [],
    batchOverrides: [{ batchId: 9, status: 'archived', toJSON() { return { ...this }; } }]
  });
  const override = record({ lessonId: 900, batchId: 9, status: 'archived' });

  const originals = {
    lessonsPaymentAccess: studentPortal.paymentAccess,
    activeEnrollments: studentPortal.activeEnrollments,
    lessonFindAll: models.LmsLesson.findAll,
    lessonFindOne: models.LmsLesson.findOne,
    overrideFindOne: models.LmsLessonBatchOverride.findOne,
    enrollmentFindAll: models.StudentEnrollment.findAll,
    feeFindAll: models.StudentFee.findAll,
    joinCreate: models.LmsLiveClassJoin.create
  };
  try {
    const access = { enrollments: [{ enrollmentId: 301, courseId: 77, batchId: 9, allowed: true }] };
    studentPortal.paymentAccess = async () => access;
    studentPortal.activeEnrollments = async () => [enrollment];
    models.LmsLesson.findAll = async () => [baseLesson];
    models.LmsLesson.findOne = async () => baseLesson;
    models.LmsLessonBatchOverride.findOne = async () => override;
    models.StudentEnrollment.findAll = async () => [enrollment];
    // A fully-paid fee, so the join rejection below is provably caused by
    // the archived-for-this-batch override and not by payment access.
    models.StudentFee.findAll = async () => [{
      id: 1, enrollmentId: 301, courseId: 77, batchId: 9, paymentType: 'full', status: 'paid', balance: 0, installments: []
    }];
    models.LmsLiveClassJoin.create = async () => record({ id: 1 });

    const [listedLesson] = await studentPortal.lessons(student, access);
    assert.equal(listedLesson.canJoin, false, 'list view must reflect the batch-specific archive, not the base lesson');
    assert.equal(listedLesson.joinStatus, 'lesson_unavailable');

    await assert.rejects(
      () => studentPortal.joinLiveClass(student, 900, {}),
      (error) => error.status === 404 && /unavailable/i.test(error.message),
      'join endpoint must reject for the same reason the list view now shows'
    );
  } finally {
    studentPortal.paymentAccess = originals.lessonsPaymentAccess;
    studentPortal.activeEnrollments = originals.activeEnrollments;
    models.LmsLesson.findAll = originals.lessonFindAll;
    models.LmsLesson.findOne = originals.lessonFindOne;
    models.LmsLessonBatchOverride.findOne = originals.overrideFindOne;
    models.StudentEnrollment.findAll = originals.enrollmentFindAll;
    models.StudentFee.findAll = originals.feeFindAll;
    models.LmsLiveClassJoin.create = originals.joinCreate;
  }
});

test('lessons() and joinLiveClass() agree when a batch override makes the class joinable', async () => {
  const now = Date.now();
  const student = { id: 502 };
  const enrollment = record({
    id: 302, studentId: 502, courseId: 78, batchId: 10, enrollmentStatus: 'active',
    enrolledAt: new Date(), course: { id: 78, name: 'Course 2' }, batch: { id: 10, name: 'Morning Batch' }
  });
  // Base lesson looks unjoinable on its own (no zoom link at all), but this
  // batch has its own override supplying a real link and a live time window.
  const baseLesson = record({
    id: 901, courseId: 78, batchId: null, lessonOrder: 1, title: 'Live Class 2',
    status: 'published', isPublished: true,
    liveClassAt: null, zoomLink: null,
    allowJoinBeforeMinutes: 30, allowJoinAfterMinutes: 150, durationMinutes: 60,
    progress: [], materials: [], comments: [],
    batchOverrides: [{
      batchId: 10, liveClassAt: new Date(now + 5 * 60000), zoomLink: 'https://zoom.example/j/OVERRIDE',
      toJSON() { return { ...this }; }
    }]
  });
  const override = record({
    lessonId: 901, batchId: 10, liveClassAt: new Date(now + 5 * 60000), zoomLink: 'https://zoom.example/j/OVERRIDE'
  });

  const originals = {
    paymentAccess: studentPortal.paymentAccess,
    activeEnrollments: studentPortal.activeEnrollments,
    lessonFindAll: models.LmsLesson.findAll,
    lessonFindOne: models.LmsLesson.findOne,
    lessonFindByPk: models.LmsLesson.findByPk,
    overrideFindOne: models.LmsLessonBatchOverride.findOne,
    enrollmentFindAll: models.StudentEnrollment.findAll,
    feeFindAll: models.StudentFee.findAll,
    joinCreate: models.LmsLiveClassJoin.create,
    attendanceFindOrCreate: models.AttendanceRecord.findOrCreate,
    progressFindOrCreate: models.LmsStudentProgress.findOrCreate
  };
  try {
    const access = { enrollments: [{ enrollmentId: 302, courseId: 78, batchId: 10, allowed: true }] };
    studentPortal.paymentAccess = async () => access;
    studentPortal.activeEnrollments = async () => [enrollment];
    models.LmsLesson.findAll = async () => [baseLesson];
    models.LmsLesson.findOne = async () => baseLesson;
    models.LmsLessonBatchOverride.findOne = async () => override;
    models.StudentEnrollment.findAll = async () => [enrollment];
    models.StudentFee.findAll = async () => [{
      id: 2, enrollmentId: 302, courseId: 78, batchId: 10, paymentType: 'full', status: 'paid', balance: 0, installments: []
    }];
    models.LmsLiveClassJoin.create = async () => record({ id: 2 });
    models.AttendanceRecord.findOrCreate = async () => [record({ id: 1, markedAt: new Date() }), true];
    models.LmsStudentProgress.findOrCreate = async () => [record({ id: 1 }), true];

    const [listedLesson] = await studentPortal.lessons(student, access);
    assert.equal(listedLesson.canJoin, true, 'list view must reflect the override-provided link/time, not the empty base lesson');
    assert.equal(listedLesson.hasLiveClass, true);

    const joinResult = await studentPortal.joinLiveClass(student, 901, {});
    assert.equal(joinResult.liveClassUrl, 'https://zoom.example/j/OVERRIDE', 'join must use the override link, matching what the list view showed');
  } finally {
    studentPortal.paymentAccess = originals.paymentAccess;
    studentPortal.activeEnrollments = originals.activeEnrollments;
    models.LmsLesson.findAll = originals.lessonFindAll;
    models.LmsLesson.findOne = originals.lessonFindOne;
    models.LmsLesson.findByPk = originals.lessonFindByPk;
    models.LmsLessonBatchOverride.findOne = originals.overrideFindOne;
    models.StudentEnrollment.findAll = originals.enrollmentFindAll;
    models.StudentFee.findAll = originals.feeFindAll;
    models.LmsLiveClassJoin.create = originals.joinCreate;
    models.AttendanceRecord.findOrCreate = originals.attendanceFindOrCreate;
    models.LmsStudentProgress.findOrCreate = originals.progressFindOrCreate;
  }
});

test('an unauthorized student (no active enrollment) is blocked from joining regardless of schedule', async () => {
  const student = { id: 503 };
  const originals = {
    activeEnrollments: studentPortal.activeEnrollments,
    lessonFindOne: models.LmsLesson.findOne,
    enrollmentFindAll: models.StudentEnrollment.findAll,
    joinCreate: models.LmsLiveClassJoin.create
  };
  try {
    studentPortal.activeEnrollments = async () => [];
    models.LmsLesson.findOne = async () => null;
    models.StudentEnrollment.findAll = async () => [];
    models.LmsLiveClassJoin.create = async () => record({ id: 3 });

    await assert.rejects(
      () => studentPortal.joinLiveClass(student, 900, {}),
      (error) => error.status === 404,
      'a student with no matching active enrollment must never be able to join'
    );
  } finally {
    studentPortal.activeEnrollments = originals.activeEnrollments;
    models.LmsLesson.findOne = originals.lessonFindOne;
    models.StudentEnrollment.findAll = originals.enrollmentFindAll;
    models.LmsLiveClassJoin.create = originals.joinCreate;
  }
});

test('paymentAccess() reuses activeEnrollments() instead of issuing a second duplicate query', async () => {
  const student = { id: 504 };
  const enrollment = record({
    id: 303, studentId: 504, courseId: 79, batchId: null, enrollmentStatus: 'active',
    enrolledAt: new Date(), course: { id: 79 }, batch: null
  });
  const originals = {
    activeEnrollments: studentPortal.activeEnrollments,
    feeFindAll: models.StudentFee.findAll
  };
  let activeEnrollmentsCalls = 0;
  try {
    studentPortal.activeEnrollments = async () => { activeEnrollmentsCalls += 1; return [enrollment]; };
    models.StudentFee.findAll = async () => [];

    const result = await studentPortal.paymentAccess(student);
    assert.equal(activeEnrollmentsCalls, 1, 'paymentAccess must fetch enrollments via activeEnrollments(), not a separate duplicate query');
    assert.equal(result.enrollments.length, 1);
  } finally {
    studentPortal.activeEnrollments = originals.activeEnrollments;
    models.StudentFee.findAll = originals.feeFindAll;
  }
});
