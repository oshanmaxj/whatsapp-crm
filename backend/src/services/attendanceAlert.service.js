const { Op } = require('sequelize');
const {
  AppSetting,
  AttendanceAlert,
  AttendanceRecord,
  Batch,
  Contact,
  Course,
  Student,
  StudentGuardian
} = require('../models');
const notificationService = require('./notification.service');
const whatsappComplianceService = require('./whatsappCompliance.service');
const whatsappService = require('./whatsapp.service');

const DEFAULT_SETTINGS = {
  attendance_alert_auto_send_enabled: false,
  attendance_alert_absent_today_enabled: true,
  attendance_alert_consecutive_2_enabled: true,
  attendance_alert_consecutive_3_enabled: true,
  attendance_alert_below_75_enabled: true,
  attendance_alert_below_50_enabled: true,
  attendance_alert_send_to_student_enabled: true,
  attendance_alert_send_to_guardian_enabled: true
};

function dateKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function percentage(records) {
  if (!records.length) return 0;
  const attended = records.filter((row) => ['present', 'late'].includes(row.status)).length;
  return Math.round((attended / records.length) * 10000) / 100;
}

function templateName(alertType) {
  if (alertType === 'absent_today') return 'ATTENDANCE_ABSENT_TODAY';
  if (String(alertType).startsWith('consecutive_absent')) return 'ATTENDANCE_CONSECUTIVE_ABSENT';
  if (String(alertType).startsWith('attendance_below')) return 'ATTENDANCE_LOW_PERCENTAGE';
  return 'attendance_alert';
}

function recipientTypeFromSettings(settings) {
  const student = settings.attendance_alert_send_to_student_enabled !== false;
  const guardian = settings.attendance_alert_send_to_guardian_enabled !== false;
  if (student && guardian) return 'both';
  if (guardian) return 'guardian';
  if (student) return 'student';
  return null;
}

function absentCount(alertType) {
  if (alertType === 'consecutive_absent_3') return 3;
  if (alertType === 'consecutive_absent_2') return 2;
  if (alertType === 'absent_today') return 1;
  return 0;
}

class AttendanceAlertService {
  include() {
    return [
      {
        model: Student,
        as: 'student',
        include: [
          { model: Contact, as: 'contact' },
          { model: Course, as: 'course' },
          { model: Batch, as: 'batch' }
        ]
      },
      { model: StudentGuardian, as: 'guardian' },
      { model: AttendanceRecord, as: 'attendanceRecord' }
    ];
  }

  async settings() {
    const [row] = await AppSetting.findOrCreate({
      where: { namespace: 'attendance_alerts', key: 'automation' },
      defaults: { value: DEFAULT_SETTINGS }
    });
    return { ...DEFAULT_SETTINGS, ...(row.value || {}) };
  }

  async list(query = {}) {
    const where = {};
    if (query.studentId) where.studentId = query.studentId;
    if (query.alertType) where.alertType = query.alertType;
    if (query.recipientType) where.recipientType = query.recipientType;
    if (query.status) where.status = query.status;
    if (query.date) where.scheduledDate = query.date;
    if (query.fromDate || query.toDate) {
      where.scheduledDate = {};
      if (query.fromDate) where.scheduledDate[Op.gte] = query.fromDate;
      if (query.toDate) where.scheduledDate[Op.lte] = query.toDate;
    }
    const rows = await AttendanceAlert.findAll({
      where,
      include: this.include(),
      order: [['scheduled_date', 'DESC'], ['created_at', 'DESC']],
      limit: 1000
    });
    return rows
      .filter((row) => !query.courseId || String(row.student?.courseId) === String(query.courseId))
      .filter((row) => !query.batchId || String(row.student?.batchId) === String(query.batchId));
  }

  history(query = {}) {
    return this.list(query);
  }

  async getDue() {
    await this.generateAll();
    return AttendanceAlert.findAll({
      where: { status: 'pending', scheduledDate: { [Op.lte]: dateKey() } },
      include: this.include(),
      order: [['scheduled_date', 'ASC'], ['created_at', 'ASC']]
    });
  }

  async generateAll() {
    const settings = await this.settings();
    if (settings.attendance_alert_auto_send_enabled !== true) {
      return { absentToday: [], consecutive: [], lowAttendance: [] };
    }
    const [absentToday, consecutive, lowAttendance] = await Promise.all([
      this.generateAbsentTodayAlerts(),
      this.generateConsecutiveAbsentAlerts(),
      this.generateLowAttendanceAlerts()
    ]);
    return { absentToday, consecutive, lowAttendance };
  }

  async generateAbsentTodayAlerts(baseDate = new Date()) {
    const settings = await this.settings();
    if (settings.attendance_alert_auto_send_enabled !== true || settings.attendance_alert_absent_today_enabled === false) return [];
    const records = await AttendanceRecord.findAll({
      where: { attendanceDate: dateKey(baseDate), status: 'absent' },
      include: [{ model: Student, as: 'student', include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch' }] }]
    });
    const rows = [];
    for (const record of records) {
      rows.push(await this.ensureAlert(record.student, 'absent_today', record, settings));
    }
    return rows.filter(Boolean);
  }

  async generateConsecutiveAbsentAlerts() {
    const settings = await this.settings();
    if (settings.attendance_alert_auto_send_enabled !== true) return [];
    const students = await this.activeStudents();
    const rows = [];
    for (const student of students) {
      const records = await AttendanceRecord.findAll({
        where: { studentId: student.id },
        order: [['attendance_date', 'DESC']],
        limit: 10
      });
      let consecutive = 0;
      for (const record of records) {
        if (record.status !== 'absent') break;
        consecutive += 1;
      }
      const latest = records[0];
      if (consecutive >= 3 && settings.attendance_alert_consecutive_3_enabled !== false) {
        rows.push(await this.ensureAlert(student, 'consecutive_absent_3', latest, settings, { absentCount: consecutive }));
      } else if (consecutive >= 2 && settings.attendance_alert_consecutive_2_enabled !== false) {
        rows.push(await this.ensureAlert(student, 'consecutive_absent_2', latest, settings, { absentCount: consecutive }));
      }
    }
    return rows.filter(Boolean);
  }

  async generateLowAttendanceAlerts() {
    const settings = await this.settings();
    if (settings.attendance_alert_auto_send_enabled !== true) return [];
    const students = await this.activeStudents();
    const rows = [];
    for (const student of students) {
      const records = await AttendanceRecord.findAll({ where: { studentId: student.id }, order: [['attendance_date', 'DESC']] });
      if (!records.length) continue;
      const rate = percentage(records);
      const latest = records[0];
      if (rate < 50 && settings.attendance_alert_below_50_enabled !== false) {
        rows.push(await this.ensureAlert(student, 'attendance_below_50', latest, settings, { attendancePercentage: rate }));
      } else if (rate < 75 && settings.attendance_alert_below_75_enabled !== false) {
        rows.push(await this.ensureAlert(student, 'attendance_below_75', latest, settings, { attendancePercentage: rate }));
      }
    }
    return rows.filter(Boolean);
  }

  activeStudents() {
    return Student.findAll({
      where: { status: { [Op.in]: ['enrolled', 'active'] } },
      include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch' }]
    });
  }

  async primaryGuardian(studentId) {
    return StudentGuardian.findOne({
      where: { studentId },
      order: [['is_primary', 'DESC'], ['created_at', 'ASC']]
    });
  }

  async ensureAlert(student, alertType, record, settings, metrics = {}) {
    if (!student) return null;
    const recipientType = recipientTypeFromSettings(settings);
    if (!recipientType) return null;
    const guardian = recipientType !== 'student' ? await this.primaryGuardian(student.id) : null;
    const scheduledDate = dateKey();
    const existing = await AttendanceAlert.findOne({
      where: { studentId: student.id, alertType, scheduledDate }
    });
    if (existing) return existing;
    const context = await this.messageContext(student, guardian, record, { ...metrics, alertType });
    return AttendanceAlert.create({
      studentId: student.id,
      guardianId: guardian?.id || null,
      attendanceRecordId: record?.id || null,
      alertType,
      scheduledDate,
      status: 'pending',
      channel: 'whatsapp',
      recipientType,
      message: this.messageFor(context, recipientType)
    });
  }

  async sendManualAlert(studentId, payload = {}) {
    const student = await Student.findByPk(studentId, {
      include: [{ model: Contact, as: 'contact' }, { model: Course, as: 'course' }, { model: Batch, as: 'batch' }]
    });
    if (!student) throw Object.assign(new Error('Student not found'), { status: 404 });
    const settings = await this.settings();
    const recipientType = payload.recipientType || recipientTypeFromSettings(settings) || 'student';
    if (!['student', 'guardian', 'both'].includes(recipientType)) {
      throw Object.assign(new Error('Invalid recipient type'), { status: 400 });
    }
    const guardian = recipientType !== 'student' ? await this.primaryGuardian(student.id) : null;
    const latest = await AttendanceRecord.findOne({ where: { studentId }, order: [['attendance_date', 'DESC']] });
    const context = await this.messageContext(student, guardian, latest, {
      alertType: 'manual',
      attendancePercentage: payload.attendancePercentage,
      absentCount: payload.absentCount
    });
    const alert = await AttendanceAlert.create({
      studentId,
      guardianId: guardian?.id || null,
      attendanceRecordId: latest?.id || null,
      alertType: 'manual',
      scheduledDate: dateKey(),
      status: 'pending',
      channel: 'whatsapp',
      recipientType,
      message: String(payload.message || '').trim() || this.messageFor(context, recipientType)
    });
    return this.sendAlert(alert.id);
  }

  async sendAlert(alertId) {
    const alert = await AttendanceAlert.findByPk(alertId, { include: this.include() });
    if (!alert) throw Object.assign(new Error('Attendance alert not found'), { status: 404 });
    if (alert.status === 'sent') return alert;

    const targets = [];
    if (['student', 'both'].includes(alert.recipientType)) {
      targets.push({
        recipient: 'student',
        name: alert.student?.name,
        number: alert.student?.contact?.whatsappId || alert.student?.phone,
        contactId: alert.student?.contactId || null
      });
    }
    if (['guardian', 'both'].includes(alert.recipientType)) {
      const guardian = alert.guardian || await this.primaryGuardian(alert.studentId);
      targets.push({
        recipient: 'guardian',
        name: guardian?.name,
        number: guardian?.whatsapp || guardian?.phone,
        contactId: await this.contactIdForNumber(guardian?.whatsapp || guardian?.phone),
        guardian
      });
    }

    const deliveries = [];
    for (const target of targets) {
      try {
        if (!target.number) {
          await this.notifyMissingRecipient(alert, target.recipient, Boolean(target.guardian));
          throw new Error(`${target.recipient === 'guardian' ? 'Guardian' : 'Student'} WhatsApp number is missing`);
        }
        deliveries.push(await this.sendToTarget(alert, target));
      } catch (error) {
        deliveries.push({
          recipient: target.recipient,
          status: 'failed',
          error: error.message,
          complianceMode: error.complianceMode || null,
          validation: error.validation || null
        });
      }
    }

    const failed = deliveries.filter((item) => item.status === 'failed');
    const status = deliveries.length > 0 && failed.length === 0 ? 'sent' : 'failed';
    await alert.update({
      status,
      sentDate: status === 'sent' ? new Date() : null,
      response: { deliveries, complianceMode: deliveries.map((item) => ({ recipient: item.recipient, mode: item.complianceMode })) }
    });
    await notificationService.create({
      type: 'attendance_alert',
      title: status === 'sent' ? 'Attendance alert sent' : 'Attendance alert failed',
      message: `${alert.student?.name || 'Student'}: ${status === 'sent' ? 'all requested recipients notified' : failed.map((item) => item.error).join('; ')}`,
      data: { alertId: alert.id, studentId: alert.studentId, status }
    });
    return AttendanceAlert.findByPk(alert.id, { include: this.include() });
  }

  async sendToTarget(alert, target) {
    const requiredType = target.contactId
      ? await whatsappComplianceService.getRequiredMessageType(target.contactId)
      : 'template';
    let validation = await whatsappComplianceService.validateTemplateUsage({
      contactId: target.contactId,
      templateName: templateName(alert.alertType),
      messageType: requiredType
    });
    if (!validation.allowed && requiredType === 'template' && templateName(alert.alertType) !== 'attendance_alert') {
      validation = await whatsappComplianceService.validateTemplateUsage({
        contactId: target.contactId,
        templateName: 'attendance_alert',
        messageType: requiredType
      });
    }
    if (!validation.allowed) {
      throw Object.assign(new Error(validation.reason), { complianceMode: requiredType, validation });
    }

    const context = await this.messageContext(alert.student, target.guardian || alert.guardian, alert.attendanceRecord, { alertType: alert.alertType });
    const targetMessage = this.messageFor(context, target.recipient);
    const realSendEnabled = process.env.WHATSAPP_SEND_ENABLED === 'true';
    let response;
    if (!realSendEnabled) {
      response = { mode: 'simulated', to: target.number, message: targetMessage };
    } else if (requiredType === 'template') {
      response = await whatsappService.sendTemplateMessage({
        to: target.number,
        templateName: validation.template.name,
        language: validation.template.language,
        components: await this.templateComponents(alert, target.guardian)
      });
    } else {
      response = await whatsappService.sendTextMessage({ to: target.number, text: targetMessage });
    }
    return {
      recipient: target.recipient,
      status: 'sent',
      complianceMode: requiredType,
      validation,
      response
    };
  }

  async contactIdForNumber(number) {
    if (!number) return null;
    const contact = await Contact.findOne({
      where: { [Op.or]: [{ phone: number }, { whatsappId: number }] }
    });
    return contact?.id || null;
  }

  async sendBulkAlerts() {
    const settings = await this.settings();
    if (settings.attendance_alert_auto_send_enabled !== true) {
      return { total: 0, sent: 0, failed: 0, skipped: true, settings, results: [] };
    }
    await this.generateAll();
    const pending = await AttendanceAlert.findAll({
      where: { status: 'pending', scheduledDate: { [Op.lte]: dateKey() } },
      order: [['scheduled_date', 'ASC'], ['created_at', 'ASC']]
    });
    const results = [];
    for (const alert of pending) {
      results.push(await this.sendAlert(alert.id).catch((error) => ({ id: alert.id, status: 'failed', error: error.message })));
    }
    return {
      total: results.length,
      sent: results.filter((row) => row.status === 'sent').length,
      failed: results.filter((row) => row.status === 'failed').length,
      results
    };
  }

  async messageContext(student, guardian, record, metrics = {}) {
    const suppliedPercentage = metrics.attendancePercentage !== undefined
      && metrics.attendancePercentage !== null
      && Number.isFinite(Number(metrics.attendancePercentage));
    const attendanceRecords = !suppliedPercentage
      ? await AttendanceRecord.findAll({ where: { studentId: student.id } })
      : [];
    const companySetting = await AppSetting.findOne({ where: { namespace: 'company', key: 'profile' } });
    return {
      studentName: student.name || 'Student',
      guardianName: guardian?.name || 'Guardian',
      courseName: student.course?.name || 'Course',
      batchName: student.batch?.name || 'Batch',
      attendanceDate: record?.attendanceDate || dateKey(),
      attendancePercentage: suppliedPercentage ? Number(metrics.attendancePercentage) : percentage(attendanceRecords),
      absentCount: metrics.absentCount ?? absentCount(metrics.alertType),
      instituteName: companySetting?.value?.name || process.env.COMPANY_NAME || 'Institute',
      contactNumber: companySetting?.value?.phone || process.env.COMPANY_PHONE || ''
    };
  }

  messageFor(context, recipientType = 'both') {
    const greeting = recipientType === 'student'
      ? context.studentName
      : recipientType === 'guardian'
        ? context.guardianName
        : 'Parent / Student';
    return [
      `Hello ${greeting}`,
      '',
      `Attendance alert for ${context.studentName} (${context.courseName}, ${context.batchName}).`,
      `Date: ${context.attendanceDate}`,
      `Attendance: ${context.attendancePercentage}%`,
      `Recent absences: ${context.absentCount}`,
      '',
      `${context.instituteName}${context.contactNumber ? ` - ${context.contactNumber}` : ''}`
    ].join('\n');
  }

  async templateComponents(alert, guardian) {
    const context = await this.messageContext(alert.student, guardian || alert.guardian, alert.attendanceRecord, { alertType: alert.alertType });
    return [{
      type: 'body',
      parameters: [
        { type: 'text', text: context.studentName },
        { type: 'text', text: context.guardianName },
        { type: 'text', text: context.courseName },
        { type: 'text', text: context.batchName },
        { type: 'text', text: String(context.attendanceDate) },
        { type: 'text', text: String(context.attendancePercentage) },
        { type: 'text', text: String(context.absentCount) },
        { type: 'text', text: context.instituteName },
        { type: 'text', text: context.contactNumber || '-' }
      ]
    }];
  }

  async notifyMissingRecipient(alert, recipient, guardianExists = true) {
    const guardianMissing = recipient === 'guardian' && !guardianExists;
    await notificationService.create({
      type: 'attendance_alert_setup',
      title: guardianMissing ? 'Guardian missing' : recipient === 'guardian' ? 'Guardian WhatsApp missing' : 'Student WhatsApp missing',
      message: guardianMissing
        ? `${alert.student?.name || 'Student'} has no guardian configured.`
        : `${alert.student?.name || 'Student'} has no ${recipient} WhatsApp number configured.`,
      data: { alertId: alert.id, studentId: alert.studentId, recipient }
    });
  }

  async getAttendanceAlertReport(filters = {}) {
    const rows = await this.history(filters);
    const students = await this.activeStudents();
    let below75 = 0;
    let below50 = 0;
    for (const student of students) {
      const records = await AttendanceRecord.findAll({ where: { studentId: student.id } });
      if (!records.length) continue;
      const rate = percentage(records);
      if (rate < 75) below75 += 1;
      if (rate < 50) below50 += 1;
    }
    return {
      generatedAlerts: rows.length,
      sentAlerts: rows.filter((row) => row.status === 'sent').length,
      failedAlerts: rows.filter((row) => row.status === 'failed').length,
      studentsBelow75: below75,
      studentsBelow50: below50,
      guardianAlertsSent: rows.filter((row) => row.status === 'sent' && ['guardian', 'both'].includes(row.recipientType)).length,
      studentAlertsSent: rows.filter((row) => row.status === 'sent' && ['student', 'both'].includes(row.recipientType)).length,
      rows
    };
  }

  report(filters = {}) {
    return this.getAttendanceAlertReport(filters);
  }
}

module.exports = new AttendanceAlertService();
