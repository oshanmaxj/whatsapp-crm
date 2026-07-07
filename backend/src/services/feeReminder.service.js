const { Op } = require('sequelize');
const {
  Batch,
  Contact,
  Conversation,
  Course,
  FeeInstallment,
  FeeReminder,
  Message,
  Student,
  StudentFee
} = require('../models');
const notificationService = require('./notification.service');
const whatsappComplianceService = require('./whatsappCompliance.service');
const whatsappService = require('./whatsapp.service');
const notificationTemplateService = require('./notificationTemplate.service');
const studentMessageAutomationService = require('./studentMessageAutomation.service');

const UPCOMING_TYPES = [
  { days: 7, type: 'upcoming_7' },
  { days: 3, type: 'upcoming_3' },
  { days: 1, type: 'upcoming_1' }
];
const OVERDUE_TYPES = [
  { days: 1, type: 'overdue_1' },
  { days: 3, type: 'overdue_3' },
  { days: 7, type: 'overdue_7' }
];

function dateKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(`${dateKey(date)}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return dateKey(next);
}

function amount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function outstanding(installment) {
  return Math.max(amount(installment.amount) - amount(installment.paidAmount), 0);
}

function money(value) {
  return amount(value).toFixed(2);
}

async function templateMessage(type, installment) {
  const student = installment.fee?.student;
  const course = installment.fee?.course;
  const studentName = student?.name || 'Student';
  const courseName = course?.name || 'your course';
  const dueDate = installment.dueDate;
  const value = money(outstanding(installment) || installment.amount);
  const balance = money(installment.fee?.balance);

  return notificationTemplateService.renderTemplate('payment_reminder', {
    student: { name: studentName, phone: student?.phone || '' },
    course: { name: courseName },
    batch: { name: installment.fee?.batch?.name || '' },
    fee: { amount: value, balance },
    installment: { no: installment.installmentNo, due_date: dueDate }
  }).catch(() => {
    if (type === 'due_today') return `Hello ${studentName}\n\nYour installment payment for ${courseName}\nis due today.\n\nAmount: Rs.${value}`;
    if (String(type).startsWith('overdue')) return `Hello ${studentName}\n\nYour installment payment for ${courseName}\nis overdue.\n\nOutstanding Amount: Rs.${value}`;
    return `Hello ${studentName}\n\nThis is a reminder that your installment of Rs.${value}\nfor ${courseName} is due on ${dueDate}.\n\nBalance: Rs.${balance}`;
  });
}

function notificationTitle(status) {
  return status === 'sent' ? 'Fee reminder sent' : 'Fee reminder failed';
}

class FeeReminderService {
  include() {
    return [
      {
        model: StudentFee,
        as: 'fee',
        include: [
          { model: Student, as: 'student', include: [{ model: Contact, as: 'contact' }] },
          { model: Course, as: 'course' },
          { model: Batch, as: 'batch' }
        ]
      }
    ];
  }

  reminderInclude() {
    return [
      { model: Student, as: 'student', include: [{ model: Contact, as: 'contact' }] },
      { model: StudentFee, as: 'fee', include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch' }] },
      { model: FeeInstallment, as: 'installment' }
    ];
  }

  async list(query = {}) {
    const where = {};
    if (query.status) where.status = query.status;
    if (query.reminderType) where.reminderType = query.reminderType;
    if (query.fromDate || query.toDate) {
      where.scheduledDate = {};
      if (query.fromDate) where.scheduledDate[Op.gte] = query.fromDate;
      if (query.toDate) where.scheduledDate[Op.lte] = query.toDate;
    }
    return FeeReminder.findAll({ where, include: this.reminderInclude(), order: [['scheduled_date', 'DESC'], ['created_at', 'DESC']], limit: 1000 });
  }

  async history(query = {}) {
    const reminders = await this.list(query);
    return reminders
      .filter((row) => !query.studentId || String(row.studentId) === String(query.studentId) || String(row.student?.name || '').toLowerCase().includes(String(query.studentId).toLowerCase()))
      .filter((row) => !query.courseId || String(row.fee?.courseId) === String(query.courseId))
      .filter((row) => !query.batchId || String(row.fee?.batchId) === String(query.batchId));
  }

  async getDue() {
    await this.generateAll();
    const pending = await FeeReminder.findAll({
      where: { status: 'pending' },
      include: this.reminderInclude(),
      order: [['scheduled_date', 'ASC'], ['created_at', 'ASC']]
    });
    return {
      upcoming7: pending.filter((item) => item.reminderType === 'upcoming_7'),
      upcoming3: pending.filter((item) => item.reminderType === 'upcoming_3'),
      upcoming1: pending.filter((item) => item.reminderType === 'upcoming_1'),
      dueToday: pending.filter((item) => item.reminderType === 'due_today'),
      overdue: pending.filter((item) => String(item.reminderType).startsWith('overdue'))
    };
  }

  async generateAll() {
    const [upcoming, dueToday, overdue] = await Promise.all([
      this.generateUpcomingReminders(),
      this.generateDueTodayReminders(),
      this.generateOverdueReminders()
    ]);
    return { upcoming, dueToday, overdue };
  }

  async generateUpcomingReminders(baseDate = new Date()) {
    const created = [];
    for (const item of UPCOMING_TYPES) {
      const dueDate = addDays(baseDate, item.days);
      const installments = await this.findInstallments({ dueDate });
      for (const installment of installments) {
        created.push(await this.ensureReminder(installment, item.type, dateKey(baseDate)));
      }
    }
    return created.filter(Boolean);
  }

  async generateDueTodayReminders(baseDate = new Date()) {
    const installments = await this.findInstallments({ dueDate: dateKey(baseDate) });
    const rows = [];
    for (const installment of installments) rows.push(await this.ensureReminder(installment, 'due_today', dateKey(baseDate)));
    return rows.filter(Boolean);
  }

  async generateOverdueReminders(baseDate = new Date()) {
    const rows = [];
    for (const item of OVERDUE_TYPES) {
      const dueDate = addDays(baseDate, -item.days);
      const installments = await this.findInstallments({ dueDate });
      for (const installment of installments) rows.push(await this.ensureReminder(installment, item.type, dateKey(baseDate)));
    }
    return rows.filter(Boolean);
  }

  findInstallments({ dueDate }) {
    return FeeInstallment.findAll({
      where: {
        dueDate,
        status: { [Op.notIn]: ['paid', 'cancelled'] }
      },
      include: this.include()
    });
  }

  async ensureReminder(installment, reminderType, scheduledDate) {
    if (!installment.fee?.studentId || outstanding(installment) <= 0) return null;
    const [row] = await FeeReminder.findOrCreate({
      where: {
        installmentId: installment.id,
        reminderType,
        scheduledDate
      },
      defaults: {
        studentId: installment.fee.studentId,
        studentFeeId: installment.studentFeeId,
        installmentId: installment.id,
        reminderType,
        scheduledDate,
        status: 'pending',
        channel: 'whatsapp',
        message: await templateMessage(reminderType, installment)
      }
    });
    await this.notifyLargeOverdue(installment).catch(() => null);
    return row;
  }

  async sendManualReminder(installmentId) {
    const installment = await FeeInstallment.findByPk(installmentId, { include: this.include() });
    if (!installment) throw Object.assign(new Error('Installment not found'), { status: 404 });
    const reminder = await FeeReminder.create({
      studentId: installment.fee.studentId,
      studentFeeId: installment.studentFeeId,
      installmentId: installment.id,
      reminderType: 'manual',
      scheduledDate: dateKey(),
      status: 'pending',
      channel: 'whatsapp',
      message: await templateMessage('manual', installment)
    });
    return this.sendReminder(reminder.id);
  }

  async sendBulkReminders() {
    await this.generateAll();
    const pending = await FeeReminder.findAll({
      where: { status: 'pending', scheduledDate: { [Op.lte]: dateKey() } },
      include: this.reminderInclude(),
      order: [['scheduled_date', 'ASC'], ['created_at', 'ASC']]
    });
    const results = [];
    for (const reminder of pending) {
      results.push(await this.sendReminder(reminder.id).catch((error) => ({ id: reminder.id, status: 'failed', error: error.message })));
    }
    return { total: results.length, sent: results.filter((item) => item.status === 'sent').length, failed: results.filter((item) => item.status === 'failed').length, results };
  }

  async sendReminder(reminderId) {
    const reminder = await FeeReminder.findByPk(reminderId, { include: this.reminderInclude() });
    if (!reminder) throw Object.assign(new Error('Fee reminder not found'), { status: 404 });
    if (reminder.status === 'sent') return reminder;

    try {
      const student = reminder.student || reminder.fee?.student;
      const queued = await studentMessageAutomationService.dispatch('payment_reminder', student.id, {
        eventId: `fee-reminder:${reminder.id}`,
        eventDate: reminder.scheduledDate,
        paymentAmount: outstanding(reminder.installment) || reminder.installment?.amount,
        installmentNo: reminder.installment?.installmentNo,
        installmentDueDate: reminder.installment?.dueDate
      });
      await reminder.update({
        status: queued.status === 'disabled' ? 'cancelled' : 'sent',
        sentDate: queued.status === 'disabled' ? null : new Date(),
        response: { mode: 'student_automation_queue', status: queued.status, queueId: queued.queue?.id || null }
      });
      if (queued.status !== 'disabled') {
        await FeeInstallment.update({ reminderSentAt: new Date() }, { where: { id: reminder.installmentId } });
        await this.notifyReminder(reminder, 'sent');
      }
      return FeeReminder.findByPk(reminder.id, { include: this.reminderInclude() });
      /*
      const compliance = await this.whatsappCompliance(reminder);
      const validation = await whatsappComplianceService.validateTemplateUsage({
        contactId: compliance.contactId,
        templateName: process.env.FEE_REMINDER_TEMPLATE_NAME || 'fee_reminder',
        messageType: compliance.windowOpen ? 'free_form' : 'template'
      });
      if (!validation.allowed) throw Object.assign(new Error(validation.reason), { status: 400 });
      const realSendEnabled = process.env.WHATSAPP_SEND_ENABLED === 'true';
      let response;
      if (!realSendEnabled) {
        response = { mode: 'simulated', compliance, validation, to: compliance.to, message: reminder.message };
      } else if (compliance.windowOpen) {
        response = await whatsappService.sendTextMessage({ to: compliance.to, text: reminder.message });
      } else {
        response = await whatsappService.sendTemplateMessage({
          to: compliance.to,
          templateName: validation.template?.name || process.env.FEE_REMINDER_TEMPLATE_NAME || 'fee_reminder',
          language: process.env.FEE_REMINDER_TEMPLATE_LANGUAGE || 'en_US',
          components: this.templateComponents(reminder)
        });
      }

      await reminder.update({ status: 'sent', sentDate: new Date(), response: { ...response, compliance, validation } });
      await FeeInstallment.update({ reminderSentAt: new Date() }, { where: { id: reminder.installmentId } });
      await this.notifyReminder(reminder, 'sent');
      return FeeReminder.findByPk(reminder.id, { include: this.reminderInclude() });
      */
    } catch (error) {
      await reminder.update({ status: 'failed', response: { message: error.message, status: error.response?.status, data: error.response?.data } });
      await this.notifyReminder(reminder, 'failed', error.message);
      return FeeReminder.findByPk(reminder.id, { include: this.reminderInclude() });
    }
  }

  async whatsappCompliance(reminder) {
    const student = reminder.student || reminder.fee?.student;
    const contactId = student?.contactId || student?.contact?.id;
    const to = student?.contact?.whatsappId || student?.phone;
    if (!to) throw Object.assign(new Error('Student WhatsApp number is missing'), { status: 400 });
    const conversation = contactId ? await Conversation.findOne({
      where: { contactId },
      order: [['last_message_at', 'DESC NULLS LAST'], ['updated_at', 'DESC']]
    }) : null;
    const inbound = contactId ? await Message.findOne({
      where: { contactId, direction: 'inbound' },
      order: [['created_at', 'DESC']]
    }) : null;
    const lastConversationAt = inbound?.createdAt || conversation?.lastMessageAt || conversation?.updatedAt || null;
    const windowOpen = lastConversationAt ? Date.now() - new Date(lastConversationAt).getTime() <= 24 * 60 * 60 * 1000 : false;
    return {
      to,
      contactId: contactId || null,
      conversationId: conversation?.id || null,
      lastConversationAt,
      windowOpen,
      mode: windowOpen ? 'session_message' : 'template_message'
    };
  }

  templateComponents(reminder) {
    const installment = reminder.installment;
    const student = reminder.student || reminder.fee?.student;
    const course = reminder.fee?.course;
    return [{
      type: 'body',
      parameters: [
        { type: 'text', text: student?.name || 'Student' },
        { type: 'text', text: money(outstanding(installment) || installment?.amount) },
        { type: 'text', text: course?.name || 'your course' },
        { type: 'text', text: installment?.dueDate || '' },
        { type: 'text', text: money(reminder.fee?.balance) }
      ]
    }];
  }

  async notifyReminder(reminder, status, detail = '') {
    const student = reminder.student || reminder.fee?.student;
    await notificationService.create({
      type: 'fee_reminder',
      title: notificationTitle(status),
      message: `${student?.name || 'Student'} ${status === 'sent' ? 'received' : 'did not receive'} fee reminder.${detail ? ` ${detail}` : ''}`,
      data: { reminderId: reminder.id, installmentId: reminder.installmentId, status }
    });
  }

  async notifyLargeOverdue(installment) {
    if (!String(installment.status).includes('overdue') && dateKey(installment.dueDate) >= dateKey()) return;
    const threshold = amount(process.env.FEE_REMINDER_LARGE_OVERDUE_THRESHOLD || 50000);
    const due = outstanding(installment);
    if (due < threshold) return;
    await notificationService.create({
      type: 'fee_overdue_balance',
      title: 'Large overdue balance detected',
      message: `${installment.fee?.student?.name || 'Student'} has overdue balance Rs.${money(due)}.`,
      data: { installmentId: installment.id, studentFeeId: installment.studentFeeId, amount: due }
    });
  }

  async report(filters = {}) {
    const rows = await this.history(filters);
    const pendingDue = await this.getDue();
    const flatDue = [...pendingDue.upcoming7, ...pendingDue.upcoming3, ...pendingDue.upcoming1, ...pendingDue.dueToday, ...pendingDue.overdue];
    return {
      totalSent: rows.filter((row) => row.status === 'sent').length,
      totalFailed: rows.filter((row) => row.status === 'failed').length,
      upcoming: flatDue.filter((row) => String(row.reminderType).startsWith('upcoming')).length,
      dueToday: flatDue.filter((row) => row.reminderType === 'due_today').length,
      overdue: flatDue.filter((row) => String(row.reminderType).startsWith('overdue')).length,
      collectionForecast: flatDue.reduce((sum, row) => sum + outstanding(row.installment), 0),
      rows
    };
  }
}

module.exports = new FeeReminderService();
