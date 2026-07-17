const {
  sequelize, Batch, Course, CourseSchedule, LmsLesson, ScheduledLesson
} = require('../models');
const { syncScheduledLessonToLms } = require('./scheduledLessonLmsSync.service');

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
    'endTime', 'timezone', 'instructorName', 'instructorId', 'topicName', 'meetingProvider', 'zoomMeetingId', 'zoomJoinUrl',
    'zoomPassword', 'joinButtonLabel', 'allowJoinBeforeMinutes', 'allowJoinAfterMinutes',
    'zoomStartUrl', 'autoCreateLessons', 'autoImportRecordings', 'reminderEnabled', 'status'
  ];
  return Object.fromEntries(fields.filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
    .map((key) => [key, payload[key] === '' ? null : payload[key]]));
}

class CourseSchedulerService {
  async validate(payload, current = null, transaction = null) {
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
    if (Number(values.allowJoinBeforeMinutes ?? 30) < 0 || Number(values.allowJoinAfterMinutes ?? 150) < 0) {
      throw Object.assign(new Error('Join window minutes cannot be negative'), { status: 400 });
    }
    const course = await Course.findByPk(values.courseId, { transaction });
    if (!course) throw Object.assign(new Error('Course not found'), { status: 400 });
    if (values.batchId) {
      const batch = await Batch.findByPk(values.batchId, { transaction });
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
    const id = await sequelize.transaction(async (transaction) => {
      const values = await this.validate(payload, null, transaction);
      const schedule = await CourseSchedule.create({ ...schedulePayload(values), createdBy: userId || null }, { transaction });
      if (schedule.autoCreateLessons) await this.reconcileLessons(schedule, userId, transaction, true);
      return schedule.id;
    });
    return this.get(id);
  }

  async update(id, payload, userId = null) {
    await sequelize.transaction(async (transaction) => {
      const row = await CourseSchedule.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw Object.assign(new Error('Course schedule not found'), { status: 404 });
      await this.validate(payload, row, transaction);
      await row.update(schedulePayload(payload), { transaction });
      const existing = await ScheduledLesson.count({ where: { scheduleId: row.id }, transaction });
      if (row.autoCreateLessons || existing) await this.reconcileLessons(row, userId, transaction, Boolean(row.autoCreateLessons));
    });
    return this.get(id);
  }

  async remove(id, userId = null) {
    await sequelize.transaction(async (transaction) => {
      const row = await CourseSchedule.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw Object.assign(new Error('Course schedule not found'), { status: 404 });
      const scheduledLessons = await ScheduledLesson.findAll({ where: { scheduleId: row.id }, transaction, lock: transaction.LOCK.UPDATE });
      for (const scheduled of scheduledLessons) {
        await scheduled.update({ status: 'cancelled', recordingImportStatus: 'skipped' }, { transaction });
        scheduled.schedule = row;
        await syncScheduledLessonToLms({ scheduledLesson: scheduled, transaction, actorUserId: userId });
      }
      await row.destroy({ transaction });
    });
    return { deleted: true, id };
  }

  async reconcileLessons(schedule, userId, transaction, createMissing = true) {
    const dates = datesBetween(schedule.startDate, schedule.endDate, schedule.classDays);
    const existing = await ScheduledLesson.findAll({
      where: { scheduleId: schedule.id }, transaction, lock: transaction.LOCK.UPDATE,
      order: [['lesson_number', 'ASC']]
    });
    const byNumber = new Map(existing.map((row) => [Number(row.lessonNumber), row]));
    for (const row of existing) {
      const desiredDate = dates[Number(row.lessonNumber) - 1];
      if (!desiredDate) continue;
      const desiredStart = dateInZone(desiredDate, schedule.startTime, schedule.timezone);
      if (new Date(row.scheduledStartAt).getTime() !== desiredStart.getTime()) {
        const temporaryStart = new Date(Date.UTC(1900, 0, 1) + Number(row.id) * 1000);
        await row.update({ scheduledStartAt: temporaryStart, scheduledEndAt: new Date(temporaryStart.getTime() + 60000) }, { transaction });
      }
    }
    let created = 0;
    let skipped = 0;
    for (let index = 0; index < dates.length; index += 1) {
      const scheduledStartAt = dateInZone(dates[index], schedule.startTime, schedule.timezone);
      const scheduledEndAt = dateInZone(dates[index], schedule.endTime, schedule.timezone);
      const lessonNumber = index + 1;
      const title = `${schedule.titlePrefix} - Lesson ${String(lessonNumber).padStart(2, '0')}`;
      let scheduled = byNumber.get(lessonNumber);
      if (!scheduled && createMissing) {
        scheduled = await ScheduledLesson.create({
          scheduleId: schedule.id,
          courseId: schedule.courseId, batchId: schedule.batchId, lessonNumber, title,
          scheduledEndAt, timezone: schedule.timezone, zoomMeetingId: schedule.zoomMeetingId,
          zoomJoinUrl: schedule.zoomJoinUrl, scheduledStartAt, status: 'scheduled',
          recordingImportStatus: schedule.autoImportRecordings ? 'pending' : 'skipped'
        }, { transaction });
        created += 1;
      }
      if (!scheduled) continue;
      if (byNumber.has(lessonNumber)) {
        await scheduled.update({
          courseId: schedule.courseId, batchId: schedule.batchId, title,
          scheduledStartAt, scheduledEndAt, timezone: schedule.timezone,
          zoomMeetingId: schedule.zoomMeetingId, zoomJoinUrl: schedule.zoomJoinUrl,
          ...(scheduled.status === 'cancelled' ? { status: 'scheduled' } : {})
        }, { transaction });
        skipped += 1;
      }
      scheduled.schedule = schedule;
      await syncScheduledLessonToLms({ scheduledLesson: scheduled, transaction, actorUserId: userId });
    }
    for (const scheduled of existing.filter((row) => Number(row.lessonNumber) > dates.length)) {
      await scheduled.update({ status: 'cancelled', recordingImportStatus: 'skipped' }, { transaction });
      scheduled.schedule = schedule;
      await syncScheduledLessonToLms({ scheduledLesson: scheduled, transaction, actorUserId: userId });
    }
    return { scheduleId: schedule.id, totalDates: dates.length, created, skipped };
  }

  async generateLessons(id, userId) {
    return sequelize.transaction(async (transaction) => {
      const schedule = await CourseSchedule.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!schedule) throw Object.assign(new Error('Course schedule not found'), { status: 404 });
      return this.reconcileLessons(schedule, userId, transaction, true);
    });
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

  async updateScheduled(id, payload, userId = null) {
    const allowed = ['title', 'courseId', 'batchId', 'scheduledStartAt', 'scheduledEndAt', 'timezone', 'zoomMeetingId', 'zoomJoinUrl', 'status', 'recordingImportStatus'];
    const values = Object.fromEntries(allowed.filter((key) => Object.prototype.hasOwnProperty.call(payload, key)).map((key) => [key, payload[key]]));
    if (values.status && !['scheduled', 'live', 'completed', 'cancelled', 'recording_imported', 'published'].includes(values.status)) {
      throw Object.assign(new Error('Invalid scheduled lesson status'), { status: 400 });
    }
    return sequelize.transaction(async (transaction) => {
      const row = await ScheduledLesson.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw Object.assign(new Error('Scheduled lesson not found'), { status: 404 });
      await row.update(values, { transaction });
      await syncScheduledLessonToLms({ scheduledLesson: row, transaction, actorUserId: userId });
      return row.reload({ transaction });
    });
  }

  async cancelScheduled(id, userId = null) {
    return this.updateScheduled(id, { status: 'cancelled', recordingImportStatus: 'skipped' }, userId);
  }
}

module.exports = new CourseSchedulerService();
module.exports.datesBetween = datesBetween;
