const { Op } = require('sequelize');
const {
  AttendanceRecord,
  AppSetting,
  Batch,
  ClassReminder,
  Contact,
  Course,
  Student,
  User
} = require('../models');
const notificationService = require('./notification.service');
const whatsappComplianceService = require('./whatsappCompliance.service');
const whatsappService = require('./whatsapp.service');

const DEFAULT_CLASS_TIME = process.env.CLASS_REMINDER_DEFAULT_TIME || '09:00';

function dateKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(`${dateKey(date)}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return dateKey(next);
}

function dateTime(date, time) {
  return new Date(`${date}T${time}:00`);
}

function formatTime(date) {
  return new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function trainerName(trainer) {
  return [trainer?.firstName, trainer?.lastName].filter(Boolean).join(' ') || trainer?.email || '';
}

function parseClassTime(schedule) {
  const match = String(schedule || '').match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (!match) return DEFAULT_CLASS_TIME;
  return `${match[1].padStart(2, '0')}:${match[2]}`;
}

function zoomLink(schedule) {
  return String(schedule || '').match(/https?:\/\/\S+/i)?.[0] || '';
}

function templateNameFor(type) {
  const envMap = {
    day_before: process.env.CLASS_REMINDER_DAY_BEFORE_TEMPLATE,
    same_day_morning: process.env.CLASS_REMINDER_SAME_DAY_TEMPLATE,
    one_hour_before: process.env.CLASS_REMINDER_ONE_HOUR_TEMPLATE,
    manual: process.env.CLASS_REMINDER_DEFAULT_TEMPLATE
  };
  const nameMap = {
    day_before: envMap.day_before || 'CLASS_REMINDER_DAY_BEFORE',
    same_day_morning: envMap.same_day_morning || 'CLASS_REMINDER_SAME_DAY',
    one_hour_before: envMap.one_hour_before || 'CLASS_REMINDER_ONE_HOUR',
    manual: envMap.manual || 'class_reminder'
  };
  return nameMap[type] || process.env.CLASS_REMINDER_DEFAULT_TEMPLATE || 'class_reminder';
}

function messageFor(type, { student, batch, classDate, classTime }) {
  const course = batch.course;
  const lecturer = trainerName(batch.trainer) || 'your lecturer';
  const zoom = zoomLink(batch.schedule);
  const lead = type === 'day_before' ? 'tomorrow' : type === 'one_hour_before' ? 'in one hour' : 'today';
  return [
    `Hello ${student.name}`,
    '',
    `Reminder: your ${course?.name || 'class'} class for ${batch.name} starts ${lead}.`,
    `Class Date: ${classDate}`,
    `Class Time: ${classTime}`,
    `Lecturer: ${lecturer}`,
    zoom ? `Zoom Link: ${zoom}` : ''
  ].filter((line) => line !== '').join('\n');
}

class ClassReminderService {
  include() {
    return [
      { model: Student, as: 'student', include: [{ model: Contact, as: 'contact' }] },
      { model: Batch, as: 'batch', include: [{ model: Course, as: 'course' }, { model: User, as: 'trainer', attributes: ['id', 'firstName', 'lastName', 'email'] }] }
    ];
  }

  async list(query = {}) {
    const where = {};
    if (query.status) where.status = query.status;
    if (query.reminderType) where.reminderType = query.reminderType;
    if (query.batchId) where.batchId = query.batchId;
    if (query.date) where.scheduleDate = query.date;
    if (query.fromDate || query.toDate) {
      where.scheduleDate = {};
      if (query.fromDate) where.scheduleDate[Op.gte] = query.fromDate;
      if (query.toDate) where.scheduleDate[Op.lte] = query.toDate;
    }
    const rows = await ClassReminder.findAll({ where, include: this.include(), order: [['scheduled_time', 'ASC']], limit: 1000 });
    return rows
      .filter((row) => !query.courseId || String(row.batch?.courseId) === String(query.courseId))
      .filter((row) => !query.studentId || String(row.studentId) === String(query.studentId));
  }

  history(query = {}) {
    return this.list(query);
  }

  async settings() {
    const defaults = {
      class_reminder_auto_send_enabled: false,
      class_reminder_day_before_enabled: true,
      class_reminder_same_day_enabled: true,
      class_reminder_one_hour_enabled: true
    };
    const [row] = await AppSetting.findOrCreate({
      where: { namespace: 'class_reminders', key: 'automation' },
      defaults: { value: defaults }
    });
    return { ...defaults, ...(row.value || {}) };
  }

  async autoSendEnabled() {
    const settings = await this.settings();
    return settings.class_reminder_auto_send_enabled === true;
  }

  async typeEnabled(reminderType) {
    const settings = await this.settings();
    if (settings.class_reminder_auto_send_enabled !== true) return false;
    const key = {
      day_before: 'class_reminder_day_before_enabled',
      same_day_morning: 'class_reminder_same_day_enabled',
      one_hour_before: 'class_reminder_one_hour_enabled'
    }[reminderType];
    return key ? settings[key] !== false : true;
  }

  async getDue() {
    await this.generateAll();
    const rows = await ClassReminder.findAll({
      where: { status: 'pending' },
      include: this.include(),
      order: [['scheduled_time', 'ASC']]
    });
    const today = dateKey();
    return {
      upcoming: rows.filter((row) => row.scheduleDate > today || row.reminderType === 'day_before'),
      today: rows.filter((row) => row.scheduleDate === today && row.reminderType !== 'day_before'),
      oneHour: rows.filter((row) => row.reminderType === 'one_hour_before'),
      due: rows.filter((row) => new Date(row.scheduledTime).getTime() <= Date.now())
    };
  }

  async generateAll() {
    if (!await this.autoSendEnabled()) return { dayBefore: [], sameDay: [], oneHour: [] };
    const [dayBefore, sameDay, oneHour] = await Promise.all([
      this.generateDayBeforeReminders(),
      this.generateSameDayReminders(),
      this.generateOneHourReminders()
    ]);
    return { dayBefore, sameDay, oneHour };
  }

  async generateDayBeforeReminders(baseDate = new Date()) {
    if (!await this.typeEnabled('day_before')) return [];
    return this.generateForDate(addDays(baseDate, 1), 'day_before', dateTime(dateKey(baseDate), '18:00'));
  }

  async generateSameDayReminders(baseDate = new Date()) {
    if (!await this.typeEnabled('same_day_morning')) return [];
    return this.generateForDate(dateKey(baseDate), 'same_day_morning', dateTime(dateKey(baseDate), '07:00'));
  }

  async generateOneHourReminders(baseDate = new Date()) {
    if (!await this.typeEnabled('one_hour_before')) return [];
    const batches = await this.findBatchesForDate(dateKey(baseDate));
    const rows = [];
    for (const batch of batches) {
      const classAt = dateTime(dateKey(baseDate), parseClassTime(batch.schedule));
      const reminderAt = new Date(classAt.getTime() - 60 * 60 * 1000);
      if (Math.abs(reminderAt.getTime() - Date.now()) <= 60 * 60 * 1000 || reminderAt <= new Date()) {
        rows.push(...await this.createForBatch(batch, dateKey(baseDate), 'one_hour_before', reminderAt));
      }
    }
    return rows.filter(Boolean);
  }

  async generateForDate(classDate, reminderType, scheduledTime) {
    const batches = await this.findBatchesForDate(classDate);
    const rows = [];
    for (const batch of batches) rows.push(...await this.createForBatch(batch, classDate, reminderType, scheduledTime));
    return rows.filter(Boolean);
  }

  findBatchesForDate(classDate) {
    return Batch.findAll({
      where: {
        status: { [Op.in]: ['upcoming', 'active'] },
        [Op.or]: [
          { startDate: classDate },
          { startDate: { [Op.lte]: classDate }, endDate: { [Op.gte]: classDate } }
        ]
      },
      include: [{ model: Course, as: 'course' }, { model: User, as: 'trainer', attributes: ['id', 'firstName', 'lastName', 'email'] }]
    });
  }

  async createForBatch(batch, classDate, reminderType, scheduledTime) {
    await this.notifyBatchDataIssues(batch);
    const students = await Student.findAll({
      where: { batchId: batch.id, status: { [Op.in]: ['enrolled', 'active'] } },
      include: [{ model: Contact, as: 'contact' }]
    });
    const classTime = parseClassTime(batch.schedule);
    const rows = [];
    if (students.length === 0) {
      await notificationService.create({
        type: 'class_reminder_setup',
        title: 'Batch has no students',
        message: `${batch.name}: no active or enrolled students found for class reminders.`,
        data: { batchId: batch.id }
      });
    }
    for (const student of students) {
      const [row] = await ClassReminder.findOrCreate({
        where: { batchId: batch.id, studentId: student.id, scheduleDate: classDate, reminderType },
        defaults: {
          batchId: batch.id,
          studentId: student.id,
          scheduleDate: classDate,
          reminderType,
          scheduledTime,
          status: 'pending',
          channel: 'whatsapp',
          message: messageFor(reminderType, { student, batch, classDate, classTime })
        }
      });
      rows.push(row);
    }
    return rows;
  }

  async sendBatchReminders(batchId) {
    const batch = await Batch.findByPk(batchId, { include: [{ model: Course, as: 'course' }, { model: User, as: 'trainer', attributes: ['id', 'firstName', 'lastName', 'email'] }] });
    if (!batch) throw Object.assign(new Error('Batch not found'), { status: 404 });
    const rows = await this.createForBatch(batch, dateKey(), 'manual', new Date());
    const results = [];
    for (const row of rows) results.push(await this.sendReminder(row.id));
    return { total: results.length, sent: results.filter((row) => row.status === 'sent').length, failed: results.filter((row) => row.status === 'failed').length, results };
  }

  async sendBulkReminders() {
    const settings = await this.settings();
    if (settings.class_reminder_auto_send_enabled !== true) {
      return { total: 0, sent: 0, failed: 0, skipped: true, settings, results: [] };
    }
    await this.generateAll();
    const enabledTypes = [];
    if (settings.class_reminder_day_before_enabled !== false) enabledTypes.push('day_before');
    if (settings.class_reminder_same_day_enabled !== false) enabledTypes.push('same_day_morning');
    if (settings.class_reminder_one_hour_enabled !== false) enabledTypes.push('one_hour_before');
    const pending = await ClassReminder.findAll({
      where: { status: 'pending', reminderType: { [Op.in]: enabledTypes }, scheduledTime: { [Op.lte]: new Date() } },
      include: this.include(),
      order: [['scheduled_time', 'ASC']]
    });
    const results = [];
    for (const reminder of pending) {
      results.push(await this.sendReminder(reminder.id).catch((error) => ({ id: reminder.id, status: 'failed', error: error.message })));
    }
    return { total: results.length, sent: results.filter((row) => row.status === 'sent').length, failed: results.filter((row) => row.status === 'failed').length, results };
  }

  async sendReminder(reminderId) {
    const reminder = await ClassReminder.findByPk(reminderId, { include: this.include() });
    if (!reminder) throw Object.assign(new Error('Class reminder not found'), { status: 404 });
    if (reminder.status === 'sent') return reminder;
    const student = reminder.student;
    const to = student?.contact?.whatsappId || student?.phone;
    let complianceMode = null;
    let validation = null;
    try {
      if (!to) throw Object.assign(new Error('Student WhatsApp number is missing'), { status: 400 });
      const requiredType = await whatsappComplianceService.getRequiredMessageType(student.contactId);
      complianceMode = requiredType;
      validation = await whatsappComplianceService.validateTemplateUsage({
        contactId: student.contactId,
        templateName: templateNameFor(reminder.reminderType),
        messageType: requiredType
      });
      if (!validation.allowed && requiredType === 'template' && templateNameFor(reminder.reminderType) !== 'class_reminder') {
        validation = await whatsappComplianceService.validateTemplateUsage({
          contactId: student.contactId,
          templateName: 'class_reminder',
          messageType: requiredType
        });
      }
      if (!validation.allowed) throw Object.assign(new Error(validation.reason), { status: 400 });

      const realSendEnabled = process.env.WHATSAPP_SEND_ENABLED === 'true';
      let response;
      if (!realSendEnabled) {
        response = { mode: 'simulated', complianceMode, to, validation, message: reminder.message };
      } else if (requiredType === 'template') {
        response = await whatsappService.sendTemplateMessage({
          to,
          templateName: validation.template.name,
          language: validation.template.language,
          components: this.templateComponents(reminder)
        });
      } else {
        response = await whatsappService.sendTextMessage({ to, text: reminder.message });
      }

      await reminder.update({ status: 'sent', sentTime: new Date(), response: { ...response, complianceMode, validation } });
      await this.notifyReminder(reminder, 'sent');
      return ClassReminder.findByPk(reminder.id, { include: this.include() });
    } catch (error) {
      await reminder.update({ status: 'failed', response: { message: error.message, status: error.response?.status, data: error.response?.data, complianceMode, validation } });
      await this.notifyReminder(reminder, 'failed', error.message);
      return ClassReminder.findByPk(reminder.id, { include: this.include() });
    }
  }

  templateComponents(reminder) {
    const batch = reminder.batch;
    return [{
      type: 'body',
      parameters: [
        { type: 'text', text: reminder.student?.name || 'Student' },
        { type: 'text', text: batch?.course?.name || 'Class' },
        { type: 'text', text: batch?.name || 'Batch' },
        { type: 'text', text: reminder.scheduleDate || '' },
        { type: 'text', text: formatTime(reminder.scheduledTime) },
        { type: 'text', text: trainerName(batch?.trainer) || 'Lecturer' },
        { type: 'text', text: zoomLink(batch?.schedule) || '-' }
      ]
    }];
  }

  async notifyReminder(reminder, status, detail = '') {
    await notificationService.create({
      type: 'class_reminder',
      title: status === 'sent' ? 'Class reminder sent' : 'Class reminder failed',
      message: `${reminder.student?.name || 'Student'} ${status === 'sent' ? 'received' : 'did not receive'} class reminder.${detail ? ` ${detail}` : ''}`,
      data: { reminderId: reminder.id, batchId: reminder.batchId, studentId: reminder.studentId, status }
    });
  }

  async notifyBatchDataIssues(batch) {
    const issues = [];
    if (!batch.schedule) issues.push(['Missing Schedule', 'Batch has no schedule configured.']);
    if (!trainerName(batch.trainer)) issues.push(['Missing Lecturer', 'Batch has no lecturer assigned.']);
    if (!zoomLink(batch.schedule)) issues.push(['Missing Zoom Link', 'Batch schedule has no Zoom link.']);
    for (const [title, message] of issues) {
      await notificationService.create({ type: 'class_reminder_setup', title, message: `${batch.name}: ${message}`, data: { batchId: batch.id } });
    }
  }

  async report(filters = {}) {
    const rows = await this.history(filters);
    const sent = rows.filter((row) => row.status === 'sent').length;
    const failed = rows.filter((row) => row.status === 'failed').length;
    const attendance = await AttendanceRecord.findAll({
      where: {
        batchId: { [Op.in]: [...new Set(rows.map((row) => row.batchId))] },
        attendanceDate: { [Op.in]: [...new Set(rows.map((row) => row.scheduleDate))] }
      }
    }).catch(() => []);
    const attendedAfterReminder = rows.filter((row) => row.status === 'sent' && attendance.some((item) => String(item.studentId) === String(row.studentId) && String(item.batchId) === String(row.batchId) && item.attendanceDate === row.scheduleDate && ['present', 'late'].includes(item.status))).length;
    return {
      scheduled: rows.length,
      sent,
      failed,
      classesToday: [...new Set(rows.filter((row) => row.scheduleDate === dateKey()).map((row) => row.batchId))].length,
      deliveryRate: rows.length ? Math.round((sent / rows.length) * 10000) / 100 : 0,
      attendanceCorrelation: {
        remindersSent: sent,
        attendedAfterReminder,
        attendanceRateAfterReminder: sent ? Math.round((attendedAfterReminder / sent) * 10000) / 100 : 0
      },
      rows
    };
  }

  getClassReminderReport(filters = {}) {
    return this.report(filters);
  }
}

module.exports = new ClassReminderService();
