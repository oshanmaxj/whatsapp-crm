const test = require('node:test');
const assert = require('node:assert/strict');

const models = require('../src/models');
const builder = require('../src/services/lmsCourseBuilder.service');
const studentPortal = require('../src/services/studentPortal.service');

test('LMS hierarchy models map course -> topic -> lesson and batch overrides', () => {
  assert.equal(models.LmsTopic.tableName, 'lms_topics');
  assert.equal(models.LmsTopic.rawAttributes.courseId.field, 'course_id');
  assert.equal(models.LmsLesson.rawAttributes.topicId.field, 'topic_id');
  assert.equal(models.LmsLesson.rawAttributes.lessonType.field, 'lesson_type');
  assert.equal(models.LmsLessonBatchOverride.tableName, 'lms_lesson_batch_overrides');
  assert.equal(models.LmsLessonBatchOverride.rawAttributes.batchId.field, 'batch_id');
  assert.ok(models.LmsTopic.associations.lessons);
  assert.ok(models.LmsLesson.associations.batchOverrides);
});

test('ordinary builder curriculum serialization never exposes Zoom credentials', () => {
  const safe = builder.safeLesson({
    id: 9, title: 'Live class', zoomLink: 'https://zoom.example/j/1', zoomMeetingId: '1', zoomPassword: 'secret'
  });
  assert.equal(safe.zoomLink, undefined);
  assert.equal(safe.zoomMeetingId, undefined);
  assert.equal(safe.zoomPassword, undefined);
  const privileged = builder.safeLesson({ zoomLink: 'https://zoom.example/j/1', zoomPassword: 'secret', batchOverrides: [{ batchId: 3, zoomPassword: 'batch-secret' }] }, { privateFields: true });
  assert.equal(privileged.hasZoomPassword, true);
  assert.equal(privileged.zoomPassword, undefined);
  assert.equal(privileged.batchOverrides[0].hasZoomPassword, true);
  assert.equal(privileged.batchOverrides[0].zoomPassword, undefined);
});

test('specific-date drip locks before release and opens after release', () => {
  const release = new Date('2026-08-10T10:00:00Z');
  const locked = studentPortal.lessonReleaseState(
    { dripType: 'specific_date', dripReleaseAt: release }, {}, true, true, new Date('2026-08-10T09:00:00Z')
  );
  const open = studentPortal.lessonReleaseState(
    { dripType: 'specific_date', dripReleaseAt: release }, {}, true, true, new Date('2026-08-10T11:00:00Z')
  );
  assert.equal(locked.locked, true);
  assert.equal(locked.reason, 'scheduled_release');
  assert.equal(open.locked, false);
});

test('enrollment and previous-completion drip rules are deterministic', () => {
  const enrollment = { enrolledAt: new Date('2026-07-01T00:00:00Z') };
  const enrollmentLock = studentPortal.lessonReleaseState(
    { dripType: 'days_after_enrollment', dripValue: 7 }, enrollment, true, true, new Date('2026-07-05T00:00:00Z')
  );
  assert.equal(enrollmentLock.locked, true);
  assert.equal(new Date(enrollmentLock.releaseAt).toISOString(), '2026-07-08T00:00:00.000Z');
  assert.equal(studentPortal.lessonReleaseState({ dripType: 'days_after_previous_completion' }, enrollment, false).locked, true);
  assert.equal(studentPortal.lessonReleaseState({ dripType: 'days_after_previous_completion' }, enrollment, true).locked, false);
});

test('disabled course drip preserves immediate access', () => {
  const result = studentPortal.lessonReleaseState(
    { dripType: 'manual' }, { enrolledAt: new Date() }, false, false
  );
  assert.deepEqual(result, { locked: false, reason: null, releaseAt: null });
});

test('topic reorder, lesson reorder, move, and curriculum hierarchy use stable IDs', async () => {
  const audit = require('../src/services/audit.service');
  const service = new builder.LmsCourseBuilderService();
  const originals = {
    transaction: models.sequelize.transaction, courseFind: models.Course.findByPk,
    topicFind: models.LmsTopic.findByPk, topicFindAll: models.LmsTopic.findAll,
    lessonFind: models.LmsLesson.findByPk, auditRecord: audit.record
  };
  const topicUpdates = [];
  const lessonUpdates = [];
  const topics = {
    10: { id: 10, courseId: 1, update: async (values) => topicUpdates.push([10, values]) },
    11: { id: 11, courseId: 1, update: async (values) => topicUpdates.push([11, values]) }
  };
  const lesson = { id: 20, courseId: 1, topicId: 10, update: async (values) => { lessonUpdates.push(values); Object.assign(lesson, values); } };
  try {
    models.sequelize.transaction = async (callback) => callback({ LOCK: { UPDATE: 'UPDATE' } });
    models.Course.findByPk = async () => ({ id: 1, instructorId: 7 });
    models.LmsTopic.findByPk = async (id) => topics[id] || null;
    models.LmsLesson.findByPk = async () => lesson;
    audit.record = async () => ({});
    const actor = { id: 7, roles: ['Lecturer'] };
    await service.reorderTopics([{ id: 11, sortOrder: 0 }, { id: 10, sortOrder: 1 }], actor);
    await service.reorderLessons([{ id: 20, topicId: 11, sortOrder: 2 }], actor);
    assert.deepEqual(topicUpdates.map((entry) => entry[1].sortOrder), [0, 1]);
    assert.equal(lessonUpdates[0].topicId, 11);
    assert.equal(lessonUpdates[0].sortOrder, 2);

    const lessonRows = [
      { toJSON: () => ({ id: 20, topicId: 10, title: 'One', zoomPassword: 'hidden' }) },
      { toJSON: () => ({ id: 21, topicId: 10, title: 'Two' }) }
    ];
    models.LmsTopic.findAll = async () => [{
      lessons: lessonRows,
      toJSON: () => ({ id: 10, courseId: 1, title: 'Topic', lessons: lessonRows.map((row) => row.toJSON()) })
    }];
    const hierarchy = await service.curriculum(1, {}, actor);
    assert.equal(hierarchy.length, 1);
    assert.deepEqual(hierarchy[0].lessons.map((item) => item.id), [20, 21]);
    assert.equal(hierarchy[0].lessons[0].zoomPassword, undefined);
  } finally {
    models.sequelize.transaction = originals.transaction;
    models.Course.findByPk = originals.courseFind;
    models.LmsTopic.findByPk = originals.topicFind;
    models.LmsTopic.findAll = originals.topicFindAll;
    models.LmsLesson.findByPk = originals.lessonFind;
    audit.record = originals.auditRecord;
  }
});
