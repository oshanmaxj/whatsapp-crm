const {
  Batch, Course, CourseSchedule, LmsLesson, ScheduledLesson
} = require('../models');
const lmsService = require('./lms.service');

const scheduleInclude = [
  { model: Course, as: 'course', attributes: ['id', 'name', 'code'] },
  { model: Batch, as: 'batch', required: false, attributes: ['id', 'name', 'code'] },
  { model: ScheduledLesson, as: 'scheduledLessons', required: false, attributes: ['id', 'status', 'recordingImportStatus'] }
];

function dateInZone(date, time, timeZone) {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute, second = 0] = String(time).split(':').map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = new Date(desired);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(guess);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const represented = Date.UTC(+values.year, +values.month - 1, +values.day, +values.hour, +values.minute, +values.second);
    guess = new Date(desired - (represented - desired));
  } catch {
    // Invalid zones are rejected separately; this keeps the helper deterministic.
  }
  return guess;
}

function dayName(date) {
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`));
}

function datesBetween(startDate, endDate, classDays) {
  const selected = new Set((classDays || []).map((day) => String(day).toLowerCase()));
  const dates = [];
  for (let date = new Date(`${startDate}T12:00:00Z`), end = new Date(`${endDate}T12:00:00Z`); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const value = date.toISOString().slice(0, 10);
    if (selected.has(dayName(value).toLowerCase())) dates.push(value);
  }
  return dates;
}

function schedulePayload(payload = {}) {
  const fields = [
    'courseId', 'batchId', 'titlePrefix', 'startDate', 'endDate', 'classDays', 'startTime',
    'endTime', 'timezone', 'instructorName', 'meetingProvider', 'zoomMeetingId', 'zoomJoinUrl',
    'zoomStartUrl', 'autoCreateLessons', 'autoImportRecordings', 'reminderEnabled', 'status'
  ];
  return Object.fromEntries(fields.filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
    .map((key) => [key, payload[key] === '' ? null : payload[key]]));
}

class CourseSchedulerService {
  async validate(payload, current = null) {
    const values = { ...(current?.toJSON?.() || {}), ...schedulePayload(payload) };
    if (!values.courseId || !values.titlePrefix || !values.startDate || !values.endDate || !values.startTime || !values.endTime) {
      throw Object.assign(new Error('Course, title prefix, date range, and class times are required'), { status: 400 });
    }
    if (!Array.isArray(values.classDays) || !values.classDays.length) {
      throw Object.assign(new Error('Select at least one class day'), { status: 400 });
    }
    if (values.endDate < values.startDate) throw Object.assign(new Error('End date must be on or after start date'), { status: 400 });
    if (String(values.endTime) <= String(values.startTime)) throw Object.assign(new Error('End time must be after start time'), { status: 400 });
    if (!['zoom', 'manual'].includes(String(values.meetingProvider || '').toLowerCase())) {
      throw Object.assign(new Error('Meeting provider must be Zoom or Manual'), { status: 400 });
    }
    if (!['active', 'paused', 'completed'].includes(values.status || 'active')) {
      throw Object.assign(new Error('Invalid schedule status'), { status: 400 });
    }
    try { new Intl.DateTimeFormat('en', { timeZone: values.timezone || 'Asia/Colombo' }).format(); } catch {
      throw Object.assign(new Error('Invalid schedule timezone'), { status: 400 });
    }
    const course = await Course.findByPk(values.courseId);
    if (!course) throw Object.assign(new Error('Course not found'), { status: 400 });
    if (values.batchId) {
      const batch = await Batch.findByPk(values.batchId);
      if (!batch || String(batch.courseId) !== String(values.courseId)) {
        throw Object.assign(new Error('Batch must belong to the selected course'), { status: 400 });
      }
    }
    return values;
  }

  async list(query = {}) {
    const where = {};
    if (query.courseId) where.courseId = query.courseId;
    if (query.batchId) where.batchId = query.batchId;
    if (query.status) where.status = query.status;
    return CourseSchedule.findAll({
      where, include: scheduleInclude,
      attributes: { exclude: ['zoomStartUrl'] },
      order: [['created_at', 'DESC']]
    });
  }

  async get(id, includeSecret = false) {
    const row = await CourseSchedule.findByPk(id, {
      include: scheduleInclude,
      ...(!includeSecret ? { attributes: { exclude: ['zoomStartUrl'] } } : {})
    });
    if (!row) throw Object.assign(new Error('Course schedule not found'), { status: 404 });
    return row;
  }

  async create(payload, userId) {
    const values = await this.validate(payload);
    return this.get((await CourseSchedule.create({ ...schedulePayload(values), createdBy: userId || null })).id);
  }

  async update(id, payload) {
    const row = await CourseSchedule.findByPk(id);
    if (!row) throw Object.assign(new Error('Course schedule not found'), { status: 404 });
    await this.validate(payload, row);
    await row.update(schedulePayload(payload));
    return this.get(id);
  }

  async remove(id) {
    const row = await CourseSchedule.findByPk(id);
    if (!row) throw Object.assign(new Error('Course schedule not found'), { status: 404 });
    await row.destroy();
    return { deleted: true, id };
  }

  async generateLessons(id, userId) {
    const schedule = await CourseSchedule.findByPk(id);
    if (!schedule) throw Object.assign(new Error('Course schedule not found'), { status: 404 });
    const dates = datesBetween(schedule.startDate, schedule.endDate, schedule.classDays);
    let created = 0;
    let skipped = 0;
    for (let index = 0; index < dates.length; index += 1) {
      const scheduledStartAt = dateInZone(dates[index], schedule.startTime, schedule.timezone);
      const scheduledEndAt = dateInZone(dates[index], schedule.endTime, schedule.timezone);
      const lessonNumber = index + 1;
      const title = `${schedule.titlePrefix} - Lesson ${String(lessonNumber).padStart(2, '0')}`;
      const [scheduled, wasCreated] = await ScheduledLesson.findOrCreate({
        where: { scheduleId: schedule.id, scheduledStartAt },
        defaults: {
          courseId: schedule.courseId, batchId: schedule.batchId, lessonNumber, title,
          scheduledEndAt, timezone: schedule.timezone, zoomMeetingId: schedule.zoomMeetingId,
          zoomJoinUrl: schedule.zoomJoinUrl, status: 'scheduled', recordingImportStatus: schedule.autoImportRecordings ? 'pending' : 'skipped'
        }
      });
      if (!wasCreated) {
        skipped += 1;
      }
      if (schedule.autoCreateLessons && !scheduled.lessonId) {
        const lesson = await lmsService.createLesson({
          courseId: schedule.courseId, batchId: schedule.batchId, title,
          description: `Automatically generated from schedule #${schedule.id}`,
          lessonOrder: lessonNumber, liveClassAt: scheduledStartAt, zoomLink: schedule.zoomJoinUrl,
          zoomMeetingId: schedule.zoomMeetingId, isPublished: true, releaseAt: null,
          durationMinutes: Math.max(1, Math.round((scheduledEndAt - scheduledStartAt) / 60000)),
          source: 'schedule', scheduleId: schedule.id, scheduledLessonId: scheduled.id,
          scheduledStartAt, scheduledEndAt, publishedAt: new Date(),
          skipClassReminder: !schedule.reminderEnabled
        }, userId);
        await scheduled.update({ lessonId: lesson.id });
      }
      if (wasCreated) created += 1;
    }
    return { scheduleId: schedule.id, totalDates: dates.length, created, skipped };
  }

  async listScheduled(query = {}) {
    const where = {};
    if (query.scheduleId) where.scheduleId = query.scheduleId;
    if (query.status) where.status = query.status;
    return ScheduledLesson.findAll({
      where,
      include: [
        { model: CourseSchedule, as: 'schedule', required: false, attributes: { exclude: ['zoomStartUrl'] } },
        { model: LmsLesson, as: 'lesson', required: false },
        { model: Course, as: 'course' }, { model: Batch, as: 'batch', required: false }
      ],
      order: [['scheduled_start_at', 'ASC']]
    });
  }

  async updateScheduled(id, payload) {
    const row = await ScheduledLesson.findByPk(id);
    if (!row) throw Object.assign(new Error('Scheduled lesson not found'), { status: 404 });
    const allowed = ['title', 'scheduledStartAt', 'scheduledEndAt', 'status', 'recordingImportStatus'];
    const values = Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(payload, key)).map((key) => [key, payload[key]]));
    if (values.status && !['scheduled', 'live', 'completed', 'cancelled', 'recording_imported', 'published'].includes(values.status)) {
      throw Object.assign(new Error('Invalid scheduled lesson status'), { status: 400 });
    }
    await row.update(values);
    if (row.lessonId) {
      await LmsLesson.update({
        ...(values.title ? { title: values.title } : {}),
        ...(values.scheduledStartAt ? { liveClassAt: values.scheduledStartAt, scheduledStartAt: values.scheduledStartAt } : {}),
        ...(values.scheduledEndAt ? { scheduledEndAt: values.scheduledEndAt } : {})
      }, { where: { id: row.lessonId } });
    }
    return row.reload();
  }

  async cancelScheduled(id) {
    return this.updateScheduled(id, { status: 'cancelled', recordingImportStatus: 'skipped' });
  }
}

module.exports = new CourseSchedulerService();
module.exports.datesBetween = datesBetween;
