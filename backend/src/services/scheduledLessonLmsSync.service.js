const {
  Batch, Course, CourseSchedule, LmsCourse, LmsLesson, LmsTopic, ScheduledLesson
} = require('../models');

const DEFAULT_TOPIC = 'Live Classes';

function normalizeTopicName(value) {
  return String(value || DEFAULT_TOPIC).trim().replace(/\s+/g, ' ').toLowerCase();
}

function courseScopeKey(courseId, batchId) {
  return `${courseId}:${batchId || 'all'}`;
}

function durationMinutes(start, end) {
  return Math.max(1, Math.round((new Date(end) - new Date(start)) / 60000));
}

async function restoreIfNeeded(row, transaction) {
  if (row?.deletedAt && typeof row.restore === 'function') await row.restore({ transaction });
  return row;
}

async function syncScheduledLessonToLms({ scheduledLesson, transaction, actorUserId = null }) {
  if (!scheduledLesson?.id) throw new Error('A persisted scheduled lesson is required for LMS synchronization');
  if (!transaction) throw new Error('LMS synchronization requires an active database transaction');

  const schedule = scheduledLesson.schedule
    || await CourseSchedule.findByPk(scheduledLesson.scheduleId, { transaction });
  const course = await Course.findByPk(scheduledLesson.courseId, { transaction });
  if (!course) throw Object.assign(new Error('Cannot synchronize LMS lesson: course not found'), { status: 400 });
  const batch = scheduledLesson.batchId
    ? await Batch.findByPk(scheduledLesson.batchId, { transaction })
    : null;
  if (scheduledLesson.batchId && !batch) throw Object.assign(new Error('Cannot synchronize LMS lesson: batch not found'), { status: 400 });

  const scopeKey = courseScopeKey(course.id, batch?.id);
  const instructorId = schedule?.instructorId || batch?.assignedTrainerId || course.instructorId || null;
  const [lmsCourse] = await LmsCourse.findOrCreate({
    where: { scopeKey }, paranoid: false, transaction,
    defaults: {
      courseId: course.id, batchId: batch?.id || null, scopeKey,
      title: batch ? `${course.name} - ${batch.name}` : course.name,
      description: course.description || course.shortDescription || null,
      instructorId, status: 'published', isPublished: true,
      createdBy: actorUserId, updatedBy: actorUserId
    }
  });
  await restoreIfNeeded(lmsCourse, transaction);
  await lmsCourse.update({
    courseId: course.id, batchId: batch?.id || null,
    title: batch ? `${course.name} - ${batch.name}` : course.name,
    description: course.description || course.shortDescription || null,
    instructorId, status: 'published', isPublished: true, updatedBy: actorUserId
  }, { transaction });

  const topicTitle = String(schedule?.topicName || DEFAULT_TOPIC).trim() || DEFAULT_TOPIC;
  const normalizedTitle = normalizeTopicName(topicTitle);
  const maxSortOrder = await LmsTopic.max('sortOrder', { where: { courseId: course.id }, transaction });
  const [topic] = await LmsTopic.findOrCreate({
    where: { lmsCourseId: lmsCourse.id, normalizedTitle }, paranoid: false, transaction,
    defaults: {
      courseId: course.id, lmsCourseId: lmsCourse.id, title: topicTitle, normalizedTitle,
      summary: `Live classes for ${batch?.name || course.name}`,
      sortOrder: Number(maxSortOrder || 0) + 1, status: 'published',
      createdBy: actorUserId, updatedBy: actorUserId
    }
  });
  await restoreIfNeeded(topic, transaction);
  await topic.update({ title: topicTitle, status: 'published', updatedBy: actorUserId }, { transaction });

  const cancelled = ['cancelled', 'archived', 'deleted'].includes(String(scheduledLesson.status).toLowerCase())
    || schedule?.status === 'paused';
  const lessonValues = {
    lmsCourseId: lmsCourse.id, courseId: course.id, topicId: topic.id,
    batchId: batch?.id || null, title: scheduledLesson.title,
    description: `Scheduled live class from course schedule #${scheduledLesson.scheduleId}`,
    summary: schedule?.instructorName ? `Live class with ${schedule.instructorName}` : null,
    lessonType: 'LIVE_CLASS', lessonOrder: scheduledLesson.lessonNumber,
    sortOrder: scheduledLesson.lessonNumber, liveClassAt: scheduledLesson.scheduledStartAt,
    scheduledStartAt: scheduledLesson.scheduledStartAt, scheduledEndAt: scheduledLesson.scheduledEndAt,
    timezone: scheduledLesson.timezone || schedule?.timezone || 'Asia/Colombo',
    durationMinutes: durationMinutes(scheduledLesson.scheduledStartAt, scheduledLesson.scheduledEndAt),
    lecturerId: instructorId, instructorName: schedule?.instructorName || null,
    zoomLink: scheduledLesson.zoomJoinUrl || schedule?.zoomJoinUrl || null,
    zoomMeetingId: scheduledLesson.zoomMeetingId || schedule?.zoomMeetingId || null,
    zoomPassword: schedule?.zoomPassword || null,
    joinButtonLabel: schedule?.joinButtonLabel || 'Join Live Class',
    allowJoinBeforeMinutes: schedule?.allowJoinBeforeMinutes ?? 30,
    allowJoinAfterMinutes: schedule?.allowJoinAfterMinutes ?? 150,
    status: cancelled ? 'archived' : 'published', isPublished: !cancelled,
    releaseAt: null, source: 'schedule', scheduleId: scheduledLesson.scheduleId,
    scheduledLessonId: scheduledLesson.id, publishedAt: cancelled ? null : new Date(),
    updatedBy: actorUserId
  };

  const [lesson] = await LmsLesson.findOrCreate({
    where: { scheduledLessonId: scheduledLesson.id }, paranoid: false, transaction,
    defaults: { ...lessonValues, createdBy: actorUserId }
  });
  await restoreIfNeeded(lesson, transaction);
  await lesson.update(lessonValues, { transaction });

  if (String(scheduledLesson.lessonId || '') !== String(lesson.id)) {
    await scheduledLesson.update({ lessonId: lesson.id }, { transaction });
  }
  return { lmsCourse, topic, lesson };
}

module.exports = { DEFAULT_TOPIC, courseScopeKey, normalizeTopicName, syncScheduledLessonToLms };
