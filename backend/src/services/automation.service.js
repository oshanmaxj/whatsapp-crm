const { Op, fn, col } = require('sequelize');
const { AppSetting, Automation, AutomationLog } = require('../models');
const classReminderService = require('./classReminder.service');
const feeReminderService = require('./feeReminder.service');
const attendanceAlertService = require('./attendanceAlert.service');
const birthdayWishService = require('./birthdayWish.service');
const notificationService = require('./notification.service');

const DEFAULT_AUTOMATIONS = [
  {
    name: 'Fee Reminder',
    code: 'FEE_REMINDER',
    description: 'Identifies upcoming and overdue installments and sends compliant payment reminders.',
    category: 'Finance',
    channel: 'whatsapp',
    scheduleType: 'daily',
    scheduleValue: '08:00'
  },
  {
    name: 'Class Reminder',
    code: 'CLASS_REMINDER',
    description: 'Sends scheduled class reminders to enrolled students.',
    category: 'Education',
    channel: 'whatsapp',
    scheduleType: 'hourly',
    scheduleValue: '0'
  },
  {
    name: 'Attendance Alert',
    code: 'ATTENDANCE_ALERT',
    description: 'Notifies students and administrators about attendance exceptions.',
    category: 'Education',
    channel: 'multi_channel',
    scheduleType: 'daily',
    scheduleValue: '18:00'
  },
  {
    name: 'Birthday Wish',
    code: 'BIRTHDAY_WISH',
    description: 'Sends birthday wishes to eligible contacts.',
    category: 'Marketing',
    channel: 'whatsapp',
    scheduleType: 'daily',
    scheduleValue: '09:00'
  },
  {
    name: 'Exam Reminder',
    code: 'EXAM_REMINDER',
    description: 'Reminds students about upcoming examinations.',
    category: 'Education',
    channel: 'whatsapp',
    scheduleType: 'daily',
    scheduleValue: '08:00'
  },
  {
    name: 'Assignment Reminder',
    code: 'ASSIGNMENT_REMINDER',
    description: 'Reminds students about upcoming assignment deadlines.',
    category: 'Education',
    channel: 'notification',
    scheduleType: 'daily',
    scheduleValue: '08:00'
  },
  {
    name: 'Certificate Ready',
    code: 'CERTIFICATE_READY',
    description: 'Notifies students when certificates are ready.',
    category: 'Education',
    channel: 'multi_channel',
    scheduleType: 'hourly',
    scheduleValue: '0'
  }
];

const CHANNELS = ['whatsapp', 'email', 'sms', 'notification', 'multi_channel'];
const SCHEDULE_TYPES = ['manual', 'hourly', 'daily', 'weekly', 'monthly'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function startOfDay(date = new Date()) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function timeParts(value, fallback = '09:00') {
  const match = String(value || fallback).match(/(\d{1,2}):(\d{2})/);
  return {
    hour: Math.min(23, Math.max(0, Number(match?.[1] || fallback.split(':')[0]))),
    minute: Math.min(59, Math.max(0, Number(match?.[2] || fallback.split(':')[1])))
  };
}

function calculateNextRun(scheduleType, scheduleValue, from = new Date()) {
  if (scheduleType === 'manual') return null;
  const next = new Date(from);

  if (scheduleType === 'hourly') {
    const minute = Math.min(59, Math.max(0, Number(scheduleValue || 0)));
    next.setSeconds(0, 0);
    next.setMinutes(minute);
    if (next <= from) next.setHours(next.getHours() + 1);
    return next;
  }

  const { hour, minute } = timeParts(scheduleValue);
  if (scheduleType === 'daily') {
    next.setHours(hour, minute, 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  if (scheduleType === 'weekly') {
    const [dayValue, timeValue] = String(scheduleValue || 'monday 09:00').toLowerCase().split(/\s+/);
    const weekday = WEEKDAYS.includes(dayValue) ? WEEKDAYS.indexOf(dayValue) : Math.min(6, Math.max(0, Number(dayValue) || 1));
    const weeklyTime = timeParts(timeValue);
    next.setHours(weeklyTime.hour, weeklyTime.minute, 0, 0);
    let days = (weekday - next.getDay() + 7) % 7;
    if (days === 0 && next <= from) days = 7;
    next.setDate(next.getDate() + days);
    return next;
  }

  const [dayValue, timeValue] = String(scheduleValue || '1 09:00').split(/\s+/);
  const day = Math.min(28, Math.max(1, Number(dayValue) || 1));
  const monthlyTime = timeParts(timeValue);
  next.setDate(day);
  next.setHours(monthlyTime.hour, monthlyTime.minute, 0, 0);
  if (next <= from) next.setMonth(next.getMonth() + 1);
  return next;
}

function resultMessage(result = {}) {
  if (result.skipped) return 'Execution completed with no sends because reminder settings are disabled.';
  const total = Number(result.total || 0);
  const sent = Number(result.sent || 0);
  const failed = Number(result.failed || 0);
  return `Execution completed. Total: ${total}, sent: ${sent}, failed: ${failed}.`;
}

class AutomationService {
  async ensureDefaults() {
    for (const definition of DEFAULT_AUTOMATIONS) {
      const [automation, created] = await Automation.findOrCreate({
        where: { code: definition.code },
        defaults: {
          ...definition,
          enabled: false,
          nextRunAt: null
        }
      });
      if (!created && automation.enabled && automation.scheduleType !== 'manual' && !automation.nextRunAt) {
        await automation.update({ nextRunAt: calculateNextRun(automation.scheduleType, automation.scheduleValue) });
      } else if (!created && !automation.enabled && automation.nextRunAt) {
        await automation.update({ nextRunAt: null });
      }
    }
  }

  async getAutomations(filters = {}) {
    await this.ensureDefaults();
    const where = {};
    if (filters.category) where.category = filters.category;
    if (filters.enabled !== undefined && filters.enabled !== '') where.enabled = String(filters.enabled) === 'true';
    if (filters.channel) where.channel = filters.channel;
    return Automation.findAll({ where, order: [['category', 'ASC'], ['name', 'ASC']] });
  }

  async getAutomation(id) {
    await this.ensureDefaults();
    const automation = await Automation.findByPk(id, {
      include: [{
        model: AutomationLog,
        as: 'logs',
        separate: true,
        order: [['started_at', 'DESC']],
        limit: 100
      }]
    });
    if (!automation) throw Object.assign(new Error('Automation not found'), { status: 404 });
    return automation;
  }

  async updateAutomation(id, payload = {}) {
    const automation = await this.getAutomation(id);
    const changes = {};
    ['name', 'description'].forEach((field) => {
      if (payload[field] !== undefined) changes[field] = payload[field];
    });
    if (payload.channel !== undefined) {
      if (!CHANNELS.includes(payload.channel)) throw Object.assign(new Error('Invalid automation channel'), { status: 400 });
      changes.channel = payload.channel;
    }
    if (payload.scheduleType !== undefined || payload.scheduleValue !== undefined) {
      Object.assign(changes, this.scheduleChanges(
        payload.scheduleType ?? automation.scheduleType,
        payload.scheduleValue ?? automation.scheduleValue,
        payload.enabled ?? automation.enabled
      ));
    }
    if (payload.enabled !== undefined) {
      changes.enabled = Boolean(payload.enabled);
      changes.nextRunAt = changes.enabled
        ? calculateNextRun(changes.scheduleType || automation.scheduleType, changes.scheduleValue ?? automation.scheduleValue)
        : null;
    }
    await automation.update(changes);
    if (payload.enabled !== undefined) await this.syncLegacySettings(automation);
    return this.getAutomation(id);
  }

  scheduleChanges(scheduleType, scheduleValue, enabled = true) {
    if (!SCHEDULE_TYPES.includes(scheduleType)) throw Object.assign(new Error('Invalid schedule type'), { status: 400 });
    const normalizedValue = scheduleType === 'manual' ? null : String(scheduleValue || '').trim();
    if (scheduleType !== 'manual' && !normalizedValue) throw Object.assign(new Error('Schedule value is required'), { status: 400 });
    return {
      scheduleType,
      scheduleValue: normalizedValue,
      nextRunAt: enabled ? calculateNextRun(scheduleType, normalizedValue) : null
    };
  }

  updateSchedule(id, scheduleType, scheduleValue) {
    return this.updateAutomation(id, { scheduleType, scheduleValue });
  }

  async toggleAutomation(id, enabled) {
    const automation = await this.getAutomation(id);
    const nextEnabled = typeof enabled === 'boolean' ? enabled : !automation.enabled;
    await automation.update({
      enabled: nextEnabled,
      nextRunAt: nextEnabled ? calculateNextRun(automation.scheduleType, automation.scheduleValue) : null
    });
    await this.syncLegacySettings(automation);
    return this.getAutomation(id);
  }

  async syncLegacySettings(automation) {
    if (!['CLASS_REMINDER', 'ATTENDANCE_ALERT', 'BIRTHDAY_WISH'].includes(automation.code)) return;
    const isClassReminder = automation.code === 'CLASS_REMINDER';
    const isAttendanceAlert = automation.code === 'ATTENDANCE_ALERT';
    const namespace = isClassReminder ? 'class_reminders' : isAttendanceAlert ? 'attendance_alerts' : 'birthday_wishes';
    const defaults = isClassReminder ? {
      class_reminder_auto_send_enabled: false,
      class_reminder_day_before_enabled: true,
      class_reminder_same_day_enabled: true,
      class_reminder_one_hour_enabled: true
    } : isAttendanceAlert ? {
      attendance_alert_auto_send_enabled: false,
      attendance_alert_absent_today_enabled: true,
      attendance_alert_consecutive_2_enabled: true,
      attendance_alert_consecutive_3_enabled: true,
      attendance_alert_below_75_enabled: true,
      attendance_alert_below_50_enabled: true,
      attendance_alert_send_to_student_enabled: true,
      attendance_alert_send_to_guardian_enabled: true
    } : {
      birthday_auto_send_enabled: false,
      birthday_send_to_students_enabled: true,
      birthday_send_to_guardians_enabled: true
    };
    const [setting] = await AppSetting.findOrCreate({
      where: { namespace, key: 'automation' },
      defaults: { value: defaults }
    });
    await setting.update({
      value: {
        ...defaults,
        ...(setting.value || {}),
        [isClassReminder
          ? 'class_reminder_auto_send_enabled'
          : isAttendanceAlert
            ? 'attendance_alert_auto_send_enabled'
            : 'birthday_auto_send_enabled']: automation.enabled
      }
    });
  }

  async runAutomation(id) {
    const automation = await this.getAutomation(id);
    if (!automation.enabled) throw Object.assign(new Error('Enable this automation before running it'), { status: 409 });

    const log = await AutomationLog.create({
      automationId: automation.id,
      status: 'running',
      startedAt: new Date(),
      message: 'Execution started.'
    });

    try {
      const result = await this.execute(automation.code);
      const sent = Number(result?.sent || 0);
      const failed = Number(result?.failed || 0);
      const successDelta = sent || (!failed ? 1 : 0);
      const completedAt = new Date();
      const message = resultMessage(result);
      await log.update({ status: 'success', message, completedAt });
      await automation.increment({ successCount: successDelta, failureCount: failed });
      await automation.update({
        lastRunAt: completedAt,
        nextRunAt: calculateNextRun(automation.scheduleType, automation.scheduleValue, completedAt)
      });
      await notificationService.create({
        type: 'automation',
        title: `${automation.name} completed`,
        message,
        data: { automationId: automation.id, automationCode: automation.code, logId: log.id }
      });
      return { automation: await this.getAutomation(id), log, result };
    } catch (error) {
      const completedAt = new Date();
      await log.update({ status: 'failed', message: error.message, completedAt });
      await automation.increment('failureCount');
      await automation.update({
        lastRunAt: completedAt,
        nextRunAt: calculateNextRun(automation.scheduleType, automation.scheduleValue, completedAt)
      });
      await notificationService.create({
        type: 'automation',
        title: `${automation.name} failed`,
        message: error.message,
        data: { automationId: automation.id, automationCode: automation.code, logId: log.id }
      });
      throw error;
    }
  }

  async execute(code) {
    if (code === 'FEE_REMINDER') return feeReminderService.sendBulkReminders();
    if (code === 'CLASS_REMINDER') return classReminderService.sendBulkReminders();
    if (code === 'ATTENDANCE_ALERT') return attendanceAlertService.sendBulkAlerts();
    if (code === 'BIRTHDAY_WISH') return birthdayWishService.sendBulkBirthdayWishes();
    throw Object.assign(new Error('This automation is registered but its executor is not available yet'), { status: 501 });
  }

  async getAutomationStats() {
    await this.ensureDefaults();
    const today = startOfDay();
    const [activeAutomations, todayRuns, successfulRuns, failedJobs, totalRuns] = await Promise.all([
      Automation.count({ where: { enabled: true } }),
      AutomationLog.count({ where: { startedAt: { [Op.gte]: today } } }),
      AutomationLog.count({ where: { status: 'success' } }),
      AutomationLog.count({ where: { status: 'failed' } }),
      AutomationLog.count({ where: { status: { [Op.in]: ['success', 'failed'] } } })
    ]);
    return {
      activeAutomations,
      todayRuns,
      successRate: totalRuns ? Math.round((successfulRuns / totalRuns) * 10000) / 100 : 0,
      failedJobs,
      totalRuns,
      successfulRuns
    };
  }

  async getAutomationReport(filters = {}) {
    await this.ensureDefaults();
    const where = {};
    if (filters.fromDate || filters.toDate) {
      where.startedAt = {};
      if (filters.fromDate) where.startedAt[Op.gte] = new Date(filters.fromDate);
      if (filters.toDate) where.startedAt[Op.lte] = new Date(`${filters.toDate}T23:59:59.999Z`);
    }
    const logs = await AutomationLog.findAll({
      where,
      include: [{ model: Automation, as: 'automation' }],
      order: [['started_at', 'DESC']],
      limit: 1000
    });
    const completed = logs.filter((row) => ['success', 'failed'].includes(row.status));
    const failed = completed.filter((row) => row.status === 'failed');
    const counts = await AutomationLog.findAll({
      where,
      attributes: ['automationId', [fn('count', col('AutomationLog.id')), 'count']],
      group: ['automationId'],
      raw: true
    });
    const mostActive = counts.sort((a, b) => Number(b.count) - Number(a.count))[0];
    const mostActiveAutomation = mostActive
      ? await Automation.findByPk(mostActive.automationId, { attributes: ['name'] })
      : null;
    const trends = new Map();
    failed.forEach((row) => {
      const key = row.startedAt.toISOString().slice(0, 10);
      trends.set(key, (trends.get(key) || 0) + 1);
    });
    return {
      runs: completed.length,
      success: completed.length - failed.length,
      failed: failed.length,
      successRate: completed.length ? Math.round(((completed.length - failed.length) / completed.length) * 10000) / 100 : 0,
      mostActiveAutomation: mostActiveAutomation?.name || '-',
      failureTrends: Array.from(trends, ([date, count]) => ({ date, count })),
      logs
    };
  }
}

module.exports = new AutomationService();
