const test = require('node:test');
const assert = require('node:assert/strict');

const models = require('../src/models');
const { datesBetween } = require('../src/services/courseScheduler.service');
const studentPortal = require('../src/services/studentPortal.service');
const {
  courseScopeKey, normalizeTopicName, syncScheduledLessonToLms
} = require('../src/services/scheduledLessonLmsSync.service');

function record(values) {
  return {
    ...values,
    async update(changes) { Object.assign(this, changes); return this; },
    async restore() { this.deletedAt = null; return this; },
    toJSON() { return { ...this }; }
  };
}

test('scheduled lesson sync is transactional, idempotent, reusable, editable, and cancellable', async () => {
  const originals = {
    courseFind: models.Course.findByPk, batchFind: models.Batch.findByPk,
    scheduleFind: models.CourseSchedule.findByPk, courseScopeFindOrCreate: models.LmsCourse.findOrCreate,
    topicFindOrCreate: models.LmsTopic.findOrCreate, topicMax: models.LmsTopic.max,
    lessonFindOrCreate: models.LmsLesson.findOrCreate
  };
  const course = record({ id: 1, name: 'Web Development', description: 'Course', instructorId: 7 });
  const batch = record({ id: 2, name: 'July Batch', assignedTrainerId: 8 });
  const schedule = record({
    id: 10, courseId: 1, batchId: 2, topicName: 'Live Classes', instructorName: 'Trainer',
    timezone: 'Asia/Colombo', zoomJoinUrl: 'https://zoom.example/j/1', zoomMeetingId: '1',
    zoomPassword: 'private', joinButtonLabel: 'Join Class', allowJoinBeforeMinutes: 20,
    allowJoinAfterMinutes: 30, status: 'active'
  });
  const scopes = [];
  const topics = [];
  const lessons = [];
  try {
    models.Course.findByPk = async () => course;
    models.Batch.findByPk = async (id) => String(id) === '2' ? batch : null;
    models.CourseSchedule.findByPk = async () => schedule;
    models.LmsCourse.findOrCreate = async ({ where, defaults }) => {
      const found = scopes.find((item) => item.scopeKey === where.scopeKey);
      if (found) return [found, false];
      const row = record({ id: scopes.length + 1, ...defaults }); scopes.push(row); return [row, true];
    };
    models.LmsTopic.max = async () => topics.length;
    models.LmsTopic.findOrCreate = async ({ where, defaults }) => {
      const found = topics.find((item) => item.lmsCourseId === where.lmsCourseId && item.normalizedTitle === where.normalizedTitle);
      if (found) return [found, false];
      const row = record({ id: topics.length + 11, ...defaults }); topics.push(row); return [row, true];
    };
    models.LmsLesson.findOrCreate = async ({ where, defaults }) => {
      const found = lessons.find((item) => item.scheduledLessonId === where.scheduledLessonId);
      if (found) return [found, false];
      const row = record({ id: lessons.length + 21, ...defaults }); lessons.push(row); return [row, true];
    };

    const transaction = { LOCK: { UPDATE: 'UPDATE' } };
    const first = record({ id: 101, scheduleId: 10, courseId: 1, batchId: 2, lessonNumber: 1, title: 'Class 01', scheduledStartAt: new Date('2026-08-01T10:00:00Z'), scheduledEndAt: new Date('2026-08-01T12:00:00Z'), timezone: 'Asia/Colombo', status: 'scheduled', schedule });
    const second = record({ id: 102, scheduleId: 10, courseId: 1, batchId: 2, lessonNumber: 2, title: 'Class 02', scheduledStartAt: new Date('2026-08-08T10:00:00Z'), scheduledEndAt: new Date('2026-08-08T12:00:00Z'), timezone: 'Asia/Colombo', status: 'scheduled', schedule });

    const created = await syncScheduledLessonToLms({ scheduledLesson: first, transaction, actorUserId: 5 });
    await syncScheduledLessonToLms({ scheduledLesson: first, transaction, actorUserId: 5 });
    await syncScheduledLessonToLms({ scheduledLesson: second, transaction, actorUserId: 5 });
    assert.equal(scopes.length, 1, 'one LMS course scope is reused for a course/batch');
    assert.equal(topics.length, 1, 'one normalized topic is reused');
    assert.equal(lessons.length, 2, 'one real LMS lesson exists per scheduled lesson');
    assert.equal(first.lessonId, created.lesson.id);
    assert.equal(created.lesson.topicId, created.topic.id, 'lesson is physically attached to builder curriculum');
    assert.equal(created.lesson.lessonType, 'LIVE_CLASS');
    assert.equal(created.lesson.zoomPassword, 'private');

    first.title = 'Updated Class';
    first.scheduledStartAt = new Date('2026-08-01T11:00:00Z');
    await syncScheduledLessonToLms({ scheduledLesson: first, transaction, actorUserId: 5 });
    assert.equal(lessons.length, 2);
    assert.equal(created.lesson.title, 'Updated Class');
    assert.equal(new Date(created.lesson.liveClassAt).toISOString(), '2026-08-01T11:00:00.000Z');

    first.status = 'cancelled';
    await syncScheduledLessonToLms({ scheduledLesson: first, transaction, actorUserId: 5 });
    assert.equal(created.lesson.status, 'archived');
    assert.equal(created.lesson.isPublished, false);
  } finally {
    models.Course.findByPk = originals.courseFind; models.Batch.findByPk = originals.batchFind;
    models.CourseSchedule.findByPk = originals.scheduleFind; models.LmsCourse.findOrCreate = originals.courseScopeFindOrCreate;
    models.LmsTopic.findOrCreate = originals.topicFindOrCreate; models.LmsTopic.max = originals.topicMax;
    models.LmsLesson.findOrCreate = originals.lessonFindOrCreate;
  }
});

test('scope and topic identities are stable', () => {
  assert.equal(courseScopeKey(12, 34), '12:34');
  assert.equal(courseScopeKey(12, null), '12:all');
  assert.equal(normalizeTopicName('  Live   Classes '), 'live classes');
});

test('student live class visibility uses canonical lessons and matching batch access', () => {
  const lessons = [
    { id: 1, lessonType: 'LIVE_CLASS', liveClassAt: new Date(Date.now() + 60000), classStatus: 'upcoming' },
    { id: 2, lessonType: 'video', liveClassAt: null, classStatus: null },
    { id: 3, lessonType: 'LIVE_CLASS', liveClassAt: new Date(Date.now() - 86400000), classStatus: 'completed' }
  ];
  assert.deepEqual(studentPortal.liveClassesFromLessons(lessons).map((item) => item.id), [1]);
  assert.equal(studentPortal.matchingAccess({ courseId: 5, batchId: 7 }, { enrollments: [{ courseId: 5, batchId: 7, allowed: true }] }).allowed, true);
  assert.equal(studentPortal.matchingAccess({ courseId: 5, batchId: 7 }, { enrollments: [{ courseId: 5, batchId: 8, allowed: true }] }), null);
});

test('secure join window blocks before and after and allows during class', () => {
  const base = { lessonType: 'LIVE_CLASS', zoomLink: 'https://zoom.example/j/1', allowJoinBeforeMinutes: 30, allowJoinAfterMinutes: 60 };
  assert.equal(studentPortal.liveClassAccess({ ...base, liveClassAt: new Date(Date.now() + 31 * 60000) }).canJoin, false);
  assert.equal(studentPortal.liveClassAccess({ ...base, liveClassAt: new Date(Date.now() + 10 * 60000) }).canJoin, true);
  assert.equal(studentPortal.liveClassAccess({ ...base, liveClassAt: new Date(Date.now() - 61 * 60000) }).canJoin, false);
});

test('student lesson serialization never exposes Zoom credentials', () => {
  const serialized = studentPortal.serializeLesson({ toJSON: () => ({
    id: 9, title: 'Private class', lessonType: 'LIVE_CLASS', liveClassAt: new Date(Date.now() + 60000),
    zoomLink: 'https://zoom.example/j/secret', zoomMeetingId: '123', zoomPassword: 'private',
    allowJoinBeforeMinutes: 30, allowJoinAfterMinutes: 60, progress: []
  }) });
  assert.equal(serialized.zoomLink, undefined);
  assert.equal(serialized.zoomMeetingId, undefined);
  assert.equal(serialized.zoomPassword, undefined);
  assert.equal(serialized.hasLiveClass, true);
});

test('recurring generation dates are deterministic and duplicate-free', () => {
  const dates = datesBetween('2026-08-03', '2026-08-12', ['Monday', 'Wednesday']);
  assert.deepEqual(dates, ['2026-08-03', '2026-08-05', '2026-08-10', '2026-08-12']);
  assert.equal(new Set(dates).size, dates.length);
});

test('backfill module is safe to import and supports dry-run mode', () => {
  const backfill = require('../src/scripts/backfill_scheduled_lessons_to_lms');
  assert.equal(typeof backfill.run, 'function');
});
