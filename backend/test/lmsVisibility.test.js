const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isStudentVisibleLesson, isStudentVisibleTopic
} = require('../src/utils/lmsVisibility');
const models = require('../src/models');
const studentPortal = require('../src/services/studentPortal.service');

test('canonical LMS visibility accepts published and legacy active statuses', () => {
  assert.equal(isStudentVisibleTopic({ status: 'published' }), true);
  assert.equal(isStudentVisibleTopic({ status: 'ACTIVE' }), true);
  assert.equal(isStudentVisibleLesson({ status: 'active', isPublished: false }), true);
  assert.equal(isStudentVisibleLesson({ status: 'scheduled', isPublished: true }), true);
});

test('canonical LMS visibility preserves intentional restrictions', () => {
  for (const status of ['draft', 'hidden', 'archived', 'cancelled', 'deleted']) {
    assert.equal(isStudentVisibleLesson({ status, isPublished: true }), false);
  }
  assert.equal(isStudentVisibleTopic({ status: 'hidden' }), false);
  assert.equal(isStudentVisibleTopic({ status: 'published', deletedAt: new Date() }), false);
});

test('lessons do not require progress data to be student-visible', () => {
  assert.equal(isStudentVisibleLesson({ status: 'published', progress: [] }), true);
  assert.equal(isStudentVisibleLesson({ status: 'published' }), true);
});

test('student curriculum returns more than three topics and totals the same visible lesson set', async () => {
  const originals = {
    enrollments: studentPortal.activeEnrollments,
    payment: studentPortal.paymentAccess,
    course: models.Course.findByPk,
    topics: models.LmsTopic.findAll
  };
  try {
    studentPortal.activeEnrollments = async () => [{ id: 7, courseId: 14, batchId: 2, enrolledAt: new Date() }];
    studentPortal.paymentAccess = async () => ({ enrollments: [{ enrollmentId: 7, allowed: true }] });
    models.Course.findByPk = async () => ({
      lmsStatus: 'published', dripEnabled: false,
      toJSON: () => ({ id: 14, name: 'Course', lmsStatus: 'published', dripEnabled: false })
    });
    models.LmsTopic.findAll = async (options) => {
      assert.equal(options.limit, undefined);
      return [1, 2, 3, 4].map((id) => ({
        toJSON: () => ({
          id, title: `Topic ${id}`, status: 'published', sortOrder: id,
          lessons: [{
            id: id * 10, topicId: id, title: `Lesson ${id}`, status: 'published',
            isPublished: true, sortOrder: 1, progress: []
          }]
        })
      }));
    };
    const result = await studentPortal.courseCurriculum({ id: 5 }, 14);
    assert.equal(result.topics.length, 4);
    assert.equal(result.progress.totalTopics, 4);
    assert.equal(result.progress.totalLessons, 4);
    assert.equal(result.progress.completedLessons, 0);
  } finally {
    studentPortal.activeEnrollments = originals.enrollments;
    studentPortal.paymentAccess = originals.payment;
    models.Course.findByPk = originals.course;
    models.LmsTopic.findAll = originals.topics;
  }
});
