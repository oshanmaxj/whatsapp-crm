const { Op, fn, col } = require('sequelize');
const {
  AttendanceRecord,
  Batch,
  Campaign,
  CampaignRecipient,
  Certificate,
  ClassReminder,
  Contact,
  Conversation,
  Course,
  Role,
  FeeInstallment,
  Followup,
  Lead,
  LeadSource,
  LeadStatus,
  Student,
  StudentFee,
  User,
  WhatsAppAccount
} = require('../models');
const logger = require('../config/logger');
const feeReminderService = require('./feeReminder.service');
const classReminderService = require('./classReminder.service');
const whatsappComplianceService = require('./whatsappCompliance.service');
const automationService = require('./automation.service');
const attendanceAlertService = require('./attendanceAlert.service');
const birthdayWishService = require('./birthdayWish.service');
const whatsappAccountAccessService = require('./whatsappAccountAccess.service');

const REPORT_TITLES = {
  overview: 'Overview Report',
  leads: 'Lead Report',
  students: 'Student Report',
  finance: 'Finance Report',
  'daily-collection': 'Daily Collection Report',
  'monthly-revenue': 'Monthly Revenue Report',
  outstanding: 'Fee Outstanding Report',
  'overdue-installments': 'Overdue Installment Report',
  campaigns: 'Campaign Report',
  'campaign-roi': 'Campaign ROI Report',
  agents: 'Agent Performance Report',
  'course-income': 'Course Income Report',
  'batch-income': 'Batch Income Report',
  attendance: 'Attendance Summary Report',
  'student-completion': 'Student Completion Report',
  'lead-source-conversion': 'Lead Source Conversion Report',
  'follow-up-pending': 'Follow-up Pending Report',
  'fee-reminders': 'Fee Reminder Report',
  'class-reminders': 'Class Reminder Report',
  automations: 'Automation Report',
  'attendance-alerts': 'Attendance Alert Report',
  'birthday-wishes': 'Birthday Wish Report',
  compliance: 'WhatsApp Compliance Report'
};

const STUDENT_STATUSES = ['enrolled', 'active', 'pending', 'completed', 'dropped', 'suspended'];
const LEAD_STATUSES = ['New', 'Contacted', 'Interested', 'Not Interested', 'Converted', 'Lost'];
const LEAD_SOURCES = ['Facebook Ads', 'WhatsApp Ads', 'Website', 'Instagram', 'TikTok', 'Google Search', 'Referral', 'Organic', 'Manual Entry'];
const PAYMENT_STATUSES = ['paid', 'pending', 'partial', 'overdue', 'cancelled'];
const PAYMENT_METHODS = ['Cash', 'Bank Deposit', 'Bank Transfer', 'Card', 'Online Payment', 'Cheque', 'Free Card', 'Scholarship', 'Other'];
const CAMPAIGN_STATUSES = ['Draft', 'Scheduled', 'Processing', 'Completed', 'Failed', 'Cancelled', 'simulated_sent'];
const ATTENDANCE_STATUSES = ['Present', 'Absent', 'Late', 'Excused'];

function amount(value) {
  return Number(value || 0);
}

function pct(part, total) {
  return total ? `${((amount(part) / amount(total)) * 100).toFixed(1)}%` : '0%';
}

function dateValue(value) {
  if (!value) return '';
  return new Date(value).toISOString().slice(0, 10);
}

function userName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || '';
}

function contactName(contact) {
  return [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || contact?.phone || '';
}

function makeReport(type, filters, summary, columns, rows, charts = []) {
  return {
    title: REPORT_TITLES[type] || 'Report',
    filters,
    summary,
    columns,
    rows,
    charts
  };
}

function emptyReport(type, filters = {}) {
  return makeReport(type, filters, [], [], [], []);
}

async function safeList(label, loader, fallback = []) {
  try {
    const result = await loader();
    return Array.isArray(result) ? result : fallback;
  } catch (error) {
    logger.warn('report_options_load_failed', { label, error });
    return fallback;
  }
}

class ReportService {
  dateWhere({ fromDate, toDate, from, to } = {}, field = 'createdAt') {
    const start = fromDate || from;
    const end = toDate || to;
    if (!start && !end) return {};
    const range = {};
    if (start) range[Op.gte] = new Date(start);
    if (end) range[Op.lte] = new Date(`${end}T23:59:59.999Z`);
    return { [field]: range };
  }

  async options(userId = null) {
    const [courses, batches, agents, leadStatuses, leadSources, departments, whatsappAccounts] = await Promise.all([
      safeList('courses', () => Course.findAll({ attributes: ['id', 'code', 'name', 'category'], order: [['name', 'ASC']] })),
      safeList('batches', () => Batch.findAll({ attributes: ['id', 'name', 'courseId', 'schedule'], include: [{ model: Course, as: 'course', attributes: ['id', 'code', 'name'] }], order: [['name', 'ASC']] })),
      safeList('agents', () => User.findAll({ where: { status: 'active' }, attributes: ['id', 'firstName', 'lastName', 'email'], include: [{ model: Role, as: 'roles', attributes: ['id', 'name'], through: { attributes: [] }, required: false }], order: [['firstName', 'ASC']] })),
      safeList('leadStatuses', () => LeadStatus.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] })),
      safeList('leadSources', () => LeadSource.findAll({ attributes: ['id', 'name'], order: [['name', 'ASC']] })),
      safeList('departments', () => Role.findAll({ where: { isActive: true }, attributes: ['id', 'name'], order: [['name', 'ASC']] })),
      safeList('whatsappAccounts', async () => {
        const where = userId ? await whatsappAccountAccessService.whereForUser(userId, 'id') : {};
        return WhatsAppAccount.findAll({ where: { status: 'active', ...where }, attributes: ['id', 'name', 'phoneNumber'], order: [['name', 'ASC']] });
      })
    ]);

    return {
      courses: courses.map((course) => ({ id: course.id, code: course.code || '', name: course.name || '', category: course.category || '' })),
      batches: batches.map((batch) => ({
        id: batch.id,
        name: batch.name || '',
        courseId: batch.courseId || null,
        courseName: batch.course?.name || '',
        courseCode: batch.course?.code || '',
        schedule: batch.schedule || ''
      })),
      agents: agents.map((agent) => ({ id: agent.id, name: userName(agent), email: agent.email, department: agent.roles?.[0]?.name || '' })),
      leadStatuses: Array.from(new Set([...leadStatuses.map((item) => item.name), ...LEAD_STATUSES])),
      leadSources: Array.from(new Set([...leadSources.map((item) => item.name), ...LEAD_SOURCES])),
      studentStatuses: STUDENT_STATUSES,
      paymentStatuses: PAYMENT_STATUSES,
      paymentMethods: PAYMENT_METHODS,
      campaignStatuses: CAMPAIGN_STATUSES,
      attendanceStatuses: ATTENDANCE_STATUSES,
      departments: departments.map((item) => ({ id: item.id, name: item.name })),
      whatsappAccounts: whatsappAccounts.map((item) => ({ id: item.id, name: item.name, phoneNumber: item.phoneNumber }))
    };
  }

  async summary(filters = {}) {
    const dateWhere = this.dateWhere(filters);
    const leadWhere = { ...dateWhere };
    if (filters.agentId) leadWhere.ownerId = filters.agentId;
    const studentWhere = { ...dateWhere };
    if (filters.courseId) studentWhere.courseId = filters.courseId;
    if (filters.batchId) studentWhere.batchId = filters.batchId;
    if (filters.studentStatus) studentWhere.status = filters.studentStatus;
    const feeWhere = {};
    if (filters.courseId) feeWhere.courseId = filters.courseId;
    if (filters.batchId) feeWhere.batchId = filters.batchId;
    const campaignWhere = { ...dateWhere };

    const [leads, students, revenue, campaign, agents] = await Promise.all([
      LeadStatus.findAll({
        where: filters.leadStatus ? { name: filters.leadStatus } : {},
        include: [{
          model: Lead,
          as: 'leads',
          where: leadWhere,
          attributes: [],
          required: false,
          include: filters.leadSource ? [{ model: LeadSource, as: 'source', where: { name: filters.leadSource }, attributes: [] }] : []
        }],
        attributes: ['name', [fn('count', col('leads.id')), 'count']],
        group: ['LeadStatus.id'],
        raw: true
      }),
      Student.findAll({ where: studentWhere, attributes: ['status', [fn('count', col('id')), 'count']], group: ['status'], raw: true }),
      StudentFee.findAll({ where: feeWhere, attributes: [[fn('sum', col('total_amount')), 'total'], [fn('sum', col('paid_amount')), 'paid']], raw: true }),
      CampaignRecipient.findAll({ where: campaignWhere, attributes: ['status', [fn('count', col('id')), 'count']], group: ['status'], raw: true }),
      User.findAll({ attributes: ['id', 'firstName', 'lastName', 'email'], limit: 20 })
    ]);
    return { leads, students, revenue: revenue[0] || {}, campaign, agents };
  }

  async report(type, filters = {}, userId = null) {
    filters = { ...filters };
    if (userId) {
      const accessibleIds = await whatsappAccountAccessService.accessibleIds(userId);
      if (filters.whatsappAccountId) {
        await whatsappAccountAccessService.assertAccess(filters.whatsappAccountId, userId);
      }
      Object.defineProperty(filters, '_accessibleAccountIds', { value: accessibleIds, enumerable: false });
    }
    const handler = {
      overview: () => this.overviewReport(filters),
      leads: () => this.leadReport(filters),
      students: () => this.studentReport(filters),
      finance: () => this.financeReport(filters),
      'daily-collection': () => this.dailyCollectionReport(filters),
      'monthly-revenue': () => this.monthlyRevenueReport(filters),
      outstanding: () => this.outstandingReport(filters),
      'overdue-installments': () => this.overdueInstallmentReport(filters),
      campaigns: () => this.campaignReport(filters),
      'campaign-roi': () => this.campaignRoiReport(filters),
      agents: () => this.agentReport(filters),
      'course-income': () => this.courseIncomeReport(filters),
      'batch-income': () => this.batchIncomeReport(filters),
      attendance: () => this.attendanceReport(filters),
      'student-completion': () => this.studentCompletionReport(filters),
      'lead-source-conversion': () => this.leadSourceConversionReport(filters),
      'follow-up-pending': () => this.followupPendingReport(filters),
      'fee-reminders': () => this.feeReminderReport(filters),
      'class-reminders': () => this.classReminderReport(filters),
      automations: () => this.automationReport(filters),
      'attendance-alerts': () => this.attendanceAlertReport(filters),
      'birthday-wishes': () => this.birthdayWishReport(filters),
      compliance: () => this.complianceReport(filters)
    }[type];
    if (!handler) return emptyReport(type, filters);
    try {
      const report = await handler();
      return {
        title: report.title || REPORT_TITLES[type] || 'Report',
        filters: report.filters || filters,
        summary: Array.isArray(report.summary) ? report.summary : [],
        columns: Array.isArray(report.columns) ? report.columns : [],
        rows: Array.isArray(report.rows) ? report.rows : [],
        charts: Array.isArray(report.charts) ? report.charts : []
      };
    } catch (error) {
      logger.warn('report_builder_failed', { type, filters, error });
      return emptyReport(type, filters);
    }
  }

  leadInclude(filters = {}) {
    return [
      { model: Contact, as: 'contact' },
      { model: LeadStatus, as: 'status', where: filters.leadStatus ? { name: filters.leadStatus } : undefined, required: !!filters.leadStatus },
      { model: LeadSource, as: 'source', where: filters.leadSource ? { name: filters.leadSource } : undefined, required: !!filters.leadSource },
      {
        model: User,
        as: 'owner',
        attributes: ['id', 'firstName', 'lastName', 'email'],
        required: Boolean(filters.departmentId),
        include: [{
          model: Role,
          as: 'roles',
          attributes: ['id', 'name'],
          through: { attributes: [] },
          where: filters.departmentId ? { id: filters.departmentId } : undefined,
          required: Boolean(filters.departmentId)
        }]
      }
    ];
  }

  leadWhere(filters) {
    const where = { ...this.dateWhere(filters) };
    if (filters.agentId) where.ownerId = filters.agentId;
    if (filters.whatsappAccountId) where.whatsappAccountId = filters.whatsappAccountId;
    else if (filters._accessibleAccountIds !== null && filters._accessibleAccountIds !== undefined) {
      where.whatsappAccountId = { [Op.in]: filters._accessibleAccountIds };
    }
    return where;
  }

  studentWhere(filters) {
    const where = { ...this.dateWhere(filters) };
    if (filters.courseId) where.courseId = filters.courseId;
    if (filters.batchId) where.batchId = filters.batchId;
    if (filters.studentStatus) where.status = filters.studentStatus;
    return where;
  }

  feeWhere(filters) {
    const where = { ...this.dateWhere(filters) };
    if (filters.courseId) where.courseId = filters.courseId;
    if (filters.batchId) where.batchId = filters.batchId;
    if (filters.paymentStatus) where.status = filters.paymentStatus;
    return where;
  }

  async leadRows(filters) {
    const leads = await Lead.findAll({ where: this.leadWhere(filters), include: this.leadInclude(filters), order: [['createdAt', 'DESC']], limit: 1000 });
    const course = filters.courseId ? await Course.findByPk(filters.courseId).catch(() => null) : null;
    const courseTokens = filters.courseId
      ? [String(filters.courseId), course?.code, course?.name].filter(Boolean).map((value) => String(value).toLowerCase())
      : [];
    return leads.filter((lead) => {
      if (!courseTokens.length) return true;
      const interested = String(lead.courseInterested || '').toLowerCase();
      return courseTokens.some((token) => interested === token || interested.includes(token));
    }).map((lead) => ({
      name: contactName(lead.contact),
      phone: lead.contact?.phone || '',
      source: lead.source?.name || '',
      status: lead.status?.name || '',
      courseInterested: lead.courseInterested || '',
      assignedAgent: userName(lead.owner),
      createdDate: dateValue(lead.createdAt),
      followUpDate: dateValue(lead.nextFollowupAt)
    }));
  }

  async leadReport(filters) {
    const rows = await this.leadRows(filters);
    const converted = rows.filter((row) => row.status === 'Converted').length;
    return makeReport('leads', filters, [
      { label: 'Total Leads', value: rows.length },
      { label: 'Converted', value: converted },
      { label: 'Conversion Rate', value: pct(converted, rows.length) }
    ], [
      { key: 'name', label: 'Lead name' },
      { key: 'phone', label: 'Phone' },
      { key: 'source', label: 'Source' },
      { key: 'status', label: 'Status' },
      { key: 'courseInterested', label: 'Course interested' },
      { key: 'assignedAgent', label: 'Assigned agent' },
      { key: 'createdDate', label: 'Created date' },
      { key: 'followUpDate', label: 'Follow-up date' }
    ], rows, this.countChart(rows, 'status'));
  }

  async studentReport(filters) {
    const students = await Student.findAll({
      where: this.studentWhere(filters),
      include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch' }],
      order: [['createdAt', 'DESC']],
      limit: 1000
    });
    const rows = students.map((student) => ({
      studentNo: student.studentNo,
      name: student.name,
      phone: student.phone,
      course: student.course?.name || '',
      batch: student.batch?.name || '',
      status: student.status,
      joinedDate: dateValue(student.enrolledAt || student.createdAt)
    }));
    return makeReport('students', filters, [
      { label: 'Total Students', value: rows.length },
      { label: 'Active', value: rows.filter((row) => row.status === 'active').length },
      { label: 'Completed', value: rows.filter((row) => row.status === 'completed').length }
    ], [
      { key: 'studentNo', label: 'Student no' },
      { key: 'name', label: 'Name' },
      { key: 'phone', label: 'Phone' },
      { key: 'course', label: 'Course' },
      { key: 'batch', label: 'Batch' },
      { key: 'status', label: 'Status' },
      { key: 'joinedDate', label: 'Joined date' }
    ], rows, this.countChart(rows, 'status'));
  }

  async financeRows(filters) {
    const fees = await StudentFee.findAll({
      where: this.feeWhere(filters),
      include: [{ model: Student, as: 'student' }, { model: Course, as: 'course' }, { model: Batch, as: 'batch' }],
      order: [['createdAt', 'DESC']],
      limit: 1000
    });
    return fees.map((fee) => ({
      receiptNo: `FEE-${fee.id}`,
      student: fee.student?.name || '',
      phone: fee.student?.phone || '',
      course: fee.course?.name || '',
      batch: fee.batch?.name || '',
      originalAmount: amount(fee.originalAmount || fee.totalAmount).toFixed(2),
      discountType: fee.discountType || 'none',
      discountAmount: amount(fee.discountAmount).toFixed(2),
      amount: amount(fee.totalAmount).toFixed(2),
      paidAmount: amount(fee.paidAmount).toFixed(2),
      balance: amount(fee.balance ?? Math.max(amount(fee.totalAmount) - amount(fee.paidAmount), 0)).toFixed(2),
      paymentMethod: fee.paymentType === 'free_card' ? 'Free Card' : fee.paymentType === 'scholarship' ? 'Scholarship' : '',
      paidDate: dateValue(fee.updatedAt),
      status: fee.status,
      dueDate: dateValue(fee.dueDate)
    }));
  }

  async financeReport(filters) {
    const rows = await this.financeRows(filters);
    return makeReport('finance', filters, this.moneySummary(rows), [
      { key: 'receiptNo', label: 'Receipt no' },
      { key: 'student', label: 'Student' },
      { key: 'course', label: 'Course' },
      { key: 'originalAmount', label: 'Original amount' },
      { key: 'discountType', label: 'Discount type' },
      { key: 'discountAmount', label: 'Discount amount' },
      { key: 'amount', label: 'Final amount' },
      { key: 'paidAmount', label: 'Paid amount' },
      { key: 'balance', label: 'Balance' },
      { key: 'paymentMethod', label: 'Payment method' },
      { key: 'paidDate', label: 'Paid date' },
      { key: 'status', label: 'Status' }
    ], rows, this.countChart(rows, 'status'));
  }

  async dailyCollectionReport(filters) {
    const rows = (await this.financeRows({ ...filters, paymentStatus: filters.paymentStatus || undefined }))
      .filter((row) => amount(row.paidAmount) > 0)
      .map((row) => ({
        date: row.paidDate,
        receiptNo: row.receiptNo,
        student: row.student,
        course: row.course,
        amount: row.paidAmount,
        paymentMethod: row.paymentMethod,
        collectedBy: ''
      }));
    return makeReport('daily-collection', filters, [
      { label: 'Total Collected', value: rows.reduce((sum, row) => sum + amount(row.amount), 0).toFixed(2) },
      { label: 'Cash Total', value: '0.00' },
      { label: 'Bank Transfer Total', value: '0.00' },
      { label: 'Online Total', value: '0.00' }
    ], [
      { key: 'date', label: 'Date' },
      { key: 'receiptNo', label: 'Receipt no' },
      { key: 'student', label: 'Student' },
      { key: 'course', label: 'Course' },
      { key: 'amount', label: 'Amount' },
      { key: 'paymentMethod', label: 'Payment method' },
      { key: 'collectedBy', label: 'Collected by' }
    ], rows);
  }

  async monthlyRevenueReport(filters) {
    const rowsByKey = new Map();
    (await this.financeRows(filters)).forEach((fee) => {
      const month = String(fee.paidDate || fee.dueDate || '').slice(0, 7) || 'Unscheduled';
      const key = `${month}-${fee.course}-${fee.batch}`;
      const current = rowsByKey.get(key) || { month, course: fee.course, batch: fee.batch, expectedIncome: 0, collected: 0, outstanding: 0 };
      current.expectedIncome += amount(fee.amount);
      current.collected += amount(fee.paidAmount);
      current.outstanding += amount(fee.balance);
      rowsByKey.set(key, current);
    });
    const rows = Array.from(rowsByKey.values()).map((row) => ({ ...row, expectedIncome: row.expectedIncome.toFixed(2), collected: row.collected.toFixed(2), outstanding: row.outstanding.toFixed(2), collectionRate: pct(row.collected, row.expectedIncome) }));
    return makeReport('monthly-revenue', filters, this.moneySummary(rows.map((row) => ({ amount: row.expectedIncome, paidAmount: row.collected, balance: row.outstanding }))), [
      { key: 'month', label: 'Month' },
      { key: 'course', label: 'Course' },
      { key: 'batch', label: 'Batch' },
      { key: 'expectedIncome', label: 'Expected income' },
      { key: 'collected', label: 'Collected' },
      { key: 'outstanding', label: 'Outstanding' },
      { key: 'collectionRate', label: 'Collection %' }
    ], rows);
  }

  async outstandingReport(filters) {
    const rows = (await this.financeRows(filters)).filter((row) => amount(row.balance) > 0).map((row) => ({
      student: row.student,
      phone: row.phone,
      course: row.course,
      batch: row.batch,
      outstandingAmount: row.balance,
      nextDueDate: row.dueDate,
      status: row.status
    }));
    return makeReport('outstanding', filters, [
      { label: 'Outstanding Records', value: rows.length },
      { label: 'Outstanding Amount', value: rows.reduce((sum, row) => sum + amount(row.outstandingAmount), 0).toFixed(2) }
    ], [
      { key: 'student', label: 'Student' },
      { key: 'phone', label: 'Phone' },
      { key: 'course', label: 'Course' },
      { key: 'batch', label: 'Batch' },
      { key: 'outstandingAmount', label: 'Outstanding amount' },
      { key: 'nextDueDate', label: 'Next due date' },
      { key: 'status', label: 'Status' }
    ], rows);
  }

  async overdueInstallmentReport(filters) {
    const where = { status: filters.paymentStatus || 'overdue' };
    if (filters.fromDate || filters.toDate) Object.assign(where, this.dateWhere(filters, 'dueDate'));
    const installments = await FeeInstallment.findAll({
      where,
      include: [{ model: StudentFee, as: 'fee', include: [{ model: Student, as: 'student' }, { model: Course, as: 'course' }, { model: Batch, as: 'batch' }] }],
      order: [['dueDate', 'ASC']],
      limit: 1000
    });
    const rows = installments
      .filter((item) => !filters.courseId || String(item.fee?.courseId) === String(filters.courseId))
      .filter((item) => !filters.batchId || String(item.fee?.batchId) === String(filters.batchId))
      .map((item) => {
        const due = item.dueDate ? new Date(item.dueDate) : new Date();
        return {
          student: item.fee?.student?.name || '',
          phone: item.fee?.student?.phone || '',
          course: item.fee?.course?.name || '',
          batch: item.fee?.batch?.name || '',
          dueAmount: Math.max(amount(item.amount) - amount(item.paidAmount), 0).toFixed(2),
          dueDate: dateValue(item.dueDate),
          daysOverdue: Math.max(Math.floor((Date.now() - due.getTime()) / 86400000), 0),
          lastReminderSent: dateValue(item.reminderSentAt),
          status: item.status
        };
      });
    return makeReport('overdue-installments', filters, [
      { label: 'Overdue Installments', value: rows.length },
      { label: 'Due Amount', value: rows.reduce((sum, row) => sum + amount(row.dueAmount), 0).toFixed(2) }
    ], [
      { key: 'student', label: 'Student' },
      { key: 'phone', label: 'Phone' },
      { key: 'course', label: 'Course' },
      { key: 'batch', label: 'Batch' },
      { key: 'dueAmount', label: 'Due amount' },
      { key: 'dueDate', label: 'Due date' },
      { key: 'daysOverdue', label: 'Days overdue' },
      { key: 'lastReminderSent', label: 'Last reminder sent' },
      { key: 'status', label: 'Status' }
    ], rows);
  }

  async campaignReport(filters) {
    const campaignWhere = { ...this.dateWhere(filters) };
    if (filters.campaignStatus && CAMPAIGN_STATUSES.includes(filters.campaignStatus) && filters.campaignStatus !== 'simulated_sent') {
      campaignWhere.status = filters.campaignStatus;
    }
    if (filters.whatsappAccountId) campaignWhere.whatsappAccountId = filters.whatsappAccountId;
    else if (filters._accessibleAccountIds !== null && filters._accessibleAccountIds !== undefined) {
      campaignWhere.whatsappAccountId = { [Op.in]: filters._accessibleAccountIds };
    }
    if (filters.departmentId) {
      const departmentUsers = await User.findAll({
        attributes: ['id'],
        include: [{ model: Role, as: 'roles', attributes: [], where: { id: filters.departmentId }, through: { attributes: [] }, required: true }]
      });
      campaignWhere.createdBy = { [Op.in]: departmentUsers.map((user) => user.id) };
    }
    const campaigns = await Campaign.findAll({ where: campaignWhere, include: [{ model: CampaignRecipient, as: 'recipients' }], order: [['createdAt', 'DESC']], limit: 1000 });
    const rows = campaigns.map((campaign) => this.campaignRow(campaign));
    return makeReport('campaigns', filters, [
      { label: 'Campaigns', value: rows.length },
      { label: 'Targeted', value: rows.reduce((sum, row) => sum + amount(row.targeted), 0) },
      { label: 'Delivered', value: rows.reduce((sum, row) => sum + amount(row.delivered), 0) }
    ], [
      { key: 'campaignName', label: 'Campaign name' },
      { key: 'status', label: 'Status' },
      { key: 'targeted', label: 'Targeted' },
      { key: 'sent', label: 'Sent' },
      { key: 'delivered', label: 'Delivered' },
      { key: 'read', label: 'Read' },
      { key: 'failed', label: 'Failed' },
      { key: 'replies', label: 'Replies' }
    ], rows, this.countChart(rows, 'status'));
  }

  campaignRow(campaign) {
    const recipients = campaign.recipients || [];
    const count = (statuses) => recipients.filter((row) => statuses.includes(row.status)).length;
    return {
      campaignName: campaign.name,
      status: campaign.status,
      targeted: recipients.length,
      sent: count(['sent', 'delivered', 'read', 'replied', 'converted', 'simulated_sent']),
      delivered: count(['delivered', 'read', 'replied', 'converted']),
      read: count(['read', 'replied', 'converted']),
      failed: count(['failed', 'unreachable']),
      replies: count(['replied', 'converted'])
    };
  }

  async campaignRoiReport(filters) {
    const base = await this.campaignReport(filters);
    const rows = base.rows.map((row) => ({
      campaignName: row.campaignName,
      spend: '0.00',
      leadsGenerated: row.replies,
      studentsConverted: 0,
      revenue: '0.00',
      costPerLead: '0.00',
      roi: '0%'
    }));
    return makeReport('campaign-roi', filters, [{ label: 'Campaigns', value: rows.length }, { label: 'Revenue', value: '0.00' }], [
      { key: 'campaignName', label: 'Campaign name' },
      { key: 'spend', label: 'Spend' },
      { key: 'leadsGenerated', label: 'Leads generated' },
      { key: 'studentsConverted', label: 'Students converted' },
      { key: 'revenue', label: 'Revenue' },
      { key: 'costPerLead', label: 'Cost per lead' },
      { key: 'roi', label: 'ROI %' }
    ], rows);
  }

  async agentReport(filters) {
    const accountWhere = {};
    if (filters.whatsappAccountId) accountWhere.whatsappAccountId = filters.whatsappAccountId;
    else if (filters._accessibleAccountIds !== null && filters._accessibleAccountIds !== undefined) {
      accountWhere.whatsappAccountId = { [Op.in]: filters._accessibleAccountIds };
    }
    const agents = await User.findAll({
      where: filters.agentId ? { id: filters.agentId } : { status: 'active' },
      attributes: ['id', 'firstName', 'lastName', 'email'],
      include: [{
        model: Role,
        as: 'roles',
        attributes: ['id', 'name'],
        through: { attributes: [] },
        where: filters.departmentId ? { id: filters.departmentId } : undefined,
        required: Boolean(filters.departmentId)
      }]
    });
    const [leads, conversations, followups] = await Promise.all([
      Lead.findAll({ where: this.leadWhere(filters), include: [{ model: LeadStatus, as: 'status' }] }),
      Conversation.findAll({ where: {
        ...(filters.agentId ? { assignedUserId: filters.agentId } : {}),
        ...(filters.departmentId ? { assignedRoleId: filters.departmentId } : {}),
        ...accountWhere
      } }),
      Followup.findAll({ where: filters.agentId ? { assignedTo: filters.agentId } : {} })
    ]);
    const rows = agents.map((agent) => {
      const agentLeads = leads.filter((lead) => String(lead.ownerId) === String(agent.id));
      const converted = agentLeads.filter((lead) => lead.status?.name === 'Converted').length;
      return {
        agent: userName(agent),
        department: agent.roles?.[0]?.name || '',
        assignedLeads: agentLeads.length,
        convertedLeads: converted,
        activeChats: conversations.filter((row) => String(row.assignedUserId) === String(agent.id) && row.status === 'open').length,
        followUps: followups.filter((row) => String(row.assignedTo) === String(agent.id) && row.status === 'pending').length,
        conversionRate: pct(converted, agentLeads.length)
      };
    });
    return makeReport('agents', filters, [{ label: 'Agents', value: rows.length }, { label: 'Assigned Leads', value: rows.reduce((sum, row) => sum + row.assignedLeads, 0) }], [
      { key: 'agent', label: 'Agent' },
      { key: 'department', label: 'Department' },
      { key: 'assignedLeads', label: 'Assigned leads' },
      { key: 'convertedLeads', label: 'Converted leads' },
      { key: 'activeChats', label: 'Active chats' },
      { key: 'followUps', label: 'Follow-ups' },
      { key: 'conversionRate', label: 'Conversion rate' }
    ], rows);
  }

  async courseIncomeReport(filters) {
    const courses = await Course.findAll({ where: filters.courseId ? { id: filters.courseId } : {}, include: [{ model: Student, as: 'students' }] });
    const fees = await StudentFee.findAll({ where: this.feeWhere(filters) });
    const rows = courses.map((course) => {
      const courseFees = fees.filter((fee) => String(fee.courseId) === String(course.id));
      const expected = courseFees.reduce((sum, fee) => sum + amount(fee.totalAmount), 0);
      const collected = courseFees.reduce((sum, fee) => sum + amount(fee.paidAmount), 0);
      return {
        courseCode: course.code || '',
        courseName: course.name,
        category: course.category || '',
        students: course.students?.length || 0,
        totalExpected: expected.toFixed(2),
        collected: collected.toFixed(2),
        outstanding: Math.max(expected - collected, 0).toFixed(2)
      };
    });
    return makeReport('course-income', filters, this.moneySummary(rows.map((row) => ({ amount: row.totalExpected, paidAmount: row.collected, balance: row.outstanding }))), [
      { key: 'courseCode', label: 'Course code' },
      { key: 'courseName', label: 'Course name' },
      { key: 'category', label: 'Category' },
      { key: 'students', label: 'Students' },
      { key: 'totalExpected', label: 'Total expected' },
      { key: 'collected', label: 'Collected' },
      { key: 'outstanding', label: 'Outstanding' }
    ], rows);
  }

  async batchIncomeReport(filters) {
    const batches = await Batch.findAll({ where: filters.batchId ? { id: filters.batchId } : {}, include: [{ model: Course, as: 'course' }, { model: Student, as: 'students' }] });
    const fees = await StudentFee.findAll({ where: this.feeWhere(filters) });
    const rows = batches.map((batch) => {
      const batchFees = fees.filter((fee) => String(fee.batchId) === String(batch.id));
      const expected = batchFees.reduce((sum, fee) => sum + amount(fee.totalAmount), 0);
      const collected = batchFees.reduce((sum, fee) => sum + amount(fee.paidAmount), 0);
      return {
        batch: batch.name,
        course: batch.course?.name || '',
        students: batch.students?.length || 0,
        collected: collected.toFixed(2),
        outstanding: Math.max(expected - collected, 0).toFixed(2),
        collectionRate: pct(collected, expected)
      };
    });
    return makeReport('batch-income', filters, this.moneySummary(rows.map((row) => ({ paidAmount: row.collected, balance: row.outstanding }))), [
      { key: 'batch', label: 'Batch' },
      { key: 'course', label: 'Course' },
      { key: 'students', label: 'Students' },
      { key: 'collected', label: 'Collected' },
      { key: 'outstanding', label: 'Outstanding' },
      { key: 'collectionRate', label: 'Collection %' }
    ], rows);
  }

  async attendanceReport(filters) {
    const where = {};
    if (filters.attendanceStatus) where.status = String(filters.attendanceStatus).toLowerCase();
    if (filters.courseId) where.courseId = filters.courseId;
    if (filters.batchId) where.batchId = filters.batchId;
    if (filters.fromDate || filters.toDate) Object.assign(where, this.dateWhere(filters, 'attendanceDate'));
    const records = await AttendanceRecord.findAll({ where, include: [{ model: Student, as: 'student' }, { model: Course, as: 'course' }, { model: Batch, as: 'batch' }], order: [['attendanceDate', 'DESC']], limit: 1000 });
    const rows = records.map((row) => ({
      date: dateValue(row.attendanceDate),
      student: row.student?.name || '',
      course: row.course?.name || '',
      batch: row.batch?.name || '',
      status: row.status,
      notes: row.notes || ''
    }));
    return makeReport('attendance', filters, [{ label: 'Records', value: rows.length }, { label: 'Present', value: rows.filter((row) => row.status === 'present').length }], [
      { key: 'date', label: 'Date' },
      { key: 'student', label: 'Student' },
      { key: 'course', label: 'Course' },
      { key: 'batch', label: 'Batch' },
      { key: 'status', label: 'Status' },
      { key: 'notes', label: 'Notes' }
    ], rows, this.countChart(rows, 'status'));
  }

  async studentCompletionReport(filters) {
    const students = await Student.findAll({ where: this.studentWhere(filters), include: [{ model: Course, as: 'course' }, { model: Batch, as: 'batch' }, { model: StudentFee, as: 'fees' }], limit: 1000 });
    const certificates = await Certificate.findAll();
    const attendance = await AttendanceRecord.findAll();
    const rows = students.map((student) => {
      const records = attendance.filter((row) => String(row.studentId) === String(student.id));
      const present = records.filter((row) => row.status === 'present').length;
      const certificate = certificates.find((row) => String(row.studentId) === String(student.id));
      return {
        student: student.name,
        course: student.course?.name || '',
        batch: student.batch?.name || '',
        attendanceRate: pct(present, records.length),
        feeStatus: student.fees?.every((fee) => fee.status === 'paid') ? 'paid' : 'pending',
        certificateStatus: certificate?.status || 'not issued',
        completionStatus: student.status === 'completed' ? 'Completed' : 'In progress'
      };
    });
    return makeReport('student-completion', filters, [{ label: 'Students', value: rows.length }, { label: 'Completed', value: rows.filter((row) => row.completionStatus === 'Completed').length }], [
      { key: 'student', label: 'Student' },
      { key: 'course', label: 'Course' },
      { key: 'batch', label: 'Batch' },
      { key: 'attendanceRate', label: 'Attendance %' },
      { key: 'feeStatus', label: 'Fee status' },
      { key: 'certificateStatus', label: 'Certificate status' },
      { key: 'completionStatus', label: 'Completion status' }
    ], rows);
  }

  async leadSourceConversionReport(filters) {
    const leads = await Lead.findAll({ where: this.leadWhere(filters), include: this.leadInclude(filters), limit: 1000 });
    const map = new Map();
    leads.forEach((lead) => {
      const source = lead.source?.name || 'Unknown';
      const row = map.get(source) || { leadSource: source, totalLeads: 0, convertedLeads: 0, revenue: 0 };
      row.totalLeads += 1;
      if (lead.status?.name === 'Converted') row.convertedLeads += 1;
      row.revenue += amount(lead.value);
      map.set(source, row);
    });
    const rows = Array.from(map.values()).map((row) => ({ ...row, conversionRate: pct(row.convertedLeads, row.totalLeads), revenue: row.revenue.toFixed(2), costPerLead: '0.00' }));
    return makeReport('lead-source-conversion', filters, [{ label: 'Lead Sources', value: rows.length }, { label: 'Leads', value: rows.reduce((sum, row) => sum + row.totalLeads, 0) }], [
      { key: 'leadSource', label: 'Lead source' },
      { key: 'totalLeads', label: 'Total leads' },
      { key: 'convertedLeads', label: 'Converted leads' },
      { key: 'conversionRate', label: 'Conversion rate' },
      { key: 'revenue', label: 'Revenue' },
      { key: 'costPerLead', label: 'Cost per lead' }
    ], rows);
  }

  async followupPendingReport(filters) {
    const where = { status: 'pending' };
    if (filters.agentId) where.assignedTo = filters.agentId;
    if (filters.fromDate || filters.toDate) Object.assign(where, this.dateWhere(filters, 'dueDate'));
    const followups = await Followup.findAll({
      where,
      include: [{ model: Lead, as: 'lead', include: [{ model: Contact, as: 'contact' }, { model: LeadStatus, as: 'status' }] }, { model: Contact, as: 'contact' }, { model: User, as: 'assignee' }],
      order: [['dueDate', 'ASC']],
      limit: 1000
    });
    const rows = followups.map((row) => ({
      lead: contactName(row.lead?.contact || row.contact),
      phone: row.lead?.contact?.phone || row.contact?.phone || '',
      assignedAgent: userName(row.assignee),
      followUpDate: dateValue(row.dueDate),
      status: row.status,
      notes: row.note || ''
    }));
    return makeReport('follow-up-pending', filters, [{ label: 'Pending Follow-ups', value: rows.length }], [
      { key: 'lead', label: 'Lead' },
      { key: 'phone', label: 'Phone' },
      { key: 'assignedAgent', label: 'Assigned agent' },
      { key: 'followUpDate', label: 'Follow-up date' },
      { key: 'status', label: 'Status' },
      { key: 'notes', label: 'Notes' }
    ], rows);
  }

  async feeReminderReport(filters) {
    const report = await feeReminderService.report(filters);
    const rows = report.rows.map((row) => ({
      scheduledDate: dateValue(row.scheduledDate),
      sentDate: dateValue(row.sentDate),
      student: row.student?.name || '',
      phone: row.student?.phone || '',
      course: row.fee?.course?.name || '',
      batch: row.fee?.batch?.name || '',
      type: row.reminderType,
      status: row.status,
      channel: row.channel,
      amount: Math.max(amount(row.installment?.amount) - amount(row.installment?.paidAmount), 0).toFixed(2)
    }));
    return makeReport('fee-reminders', filters, [
      { label: 'Total Sent', value: report.totalSent },
      { label: 'Total Failed', value: report.totalFailed },
      { label: 'Upcoming', value: report.upcoming },
      { label: 'Due Today', value: report.dueToday },
      { label: 'Overdue', value: report.overdue },
      { label: 'Collection Forecast', value: report.collectionForecast.toFixed(2) }
    ], [
      { key: 'scheduledDate', label: 'Scheduled date' },
      { key: 'sentDate', label: 'Sent date' },
      { key: 'student', label: 'Student' },
      { key: 'phone', label: 'Phone' },
      { key: 'course', label: 'Course' },
      { key: 'batch', label: 'Batch' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'channel', label: 'Channel' },
      { key: 'amount', label: 'Amount' }
    ], rows, this.countChart(rows, 'status'));
  }

  async complianceReport(filters) {
    const report = await whatsappComplianceService.report(filters);
    const rows = report.logs.map((row) => ({
      date: dateValue(row.createdAt),
      contactId: row.contactId || '',
      messageType: row.messageType,
      windowStatus: row.windowStatus,
      templateId: row.templateId || '',
      allowed: row.allowed ? 'Allowed' : 'Blocked',
      reason: row.reason || ''
    }));
    return makeReport('compliance', filters, [
      { label: 'Messages Sent', value: report.messagesSent },
      { label: 'Template Messages', value: report.templateMessages },
      { label: 'Free Form Messages', value: report.freeFormMessages },
      { label: 'Violations Prevented', value: report.violationsPrevented }
    ], [
      { key: 'date', label: 'Date' },
      { key: 'contactId', label: 'Contact ID' },
      { key: 'messageType', label: 'Message type' },
      { key: 'windowStatus', label: 'Window status' },
      { key: 'templateId', label: 'Template ID' },
      { key: 'allowed', label: 'Allowed' },
      { key: 'reason', label: 'Reason' }
    ], rows, this.countChart(rows, 'allowed'));
  }

  async classReminderReport(filters) {
    const report = await classReminderService.getClassReminderReport(filters);
    const rows = report.rows.map((row) => ({
      scheduleDate: dateValue(row.scheduleDate),
      sentTime: dateValue(row.sentTime),
      student: row.student?.name || '',
      course: row.batch?.course?.name || '',
      batch: row.batch?.name || '',
      type: row.reminderType,
      status: row.status,
      channel: row.channel,
      attendance: ''
    }));
    return makeReport('class-reminders', filters, [
      { label: 'Scheduled', value: report.scheduled },
      { label: 'Sent', value: report.sent },
      { label: 'Failed', value: report.failed },
      { label: 'Delivery Rate', value: `${report.deliveryRate}%` },
      { label: 'Classes Today', value: report.classesToday },
      { label: 'Attendance After Reminder', value: `${report.attendanceCorrelation.attendanceRateAfterReminder}%` }
    ], [
      { key: 'scheduleDate', label: 'Class date' },
      { key: 'sentTime', label: 'Sent time' },
      { key: 'student', label: 'Student' },
      { key: 'course', label: 'Course' },
      { key: 'batch', label: 'Batch' },
      { key: 'type', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'channel', label: 'Channel' },
      { key: 'attendance', label: 'Attendance correlation' }
    ], rows, this.countChart(rows, 'status'));
  }

  async automationReport(filters) {
    const report = await automationService.getAutomationReport(filters);
    const rows = report.logs.map((row) => ({
      date: dateValue(row.startedAt),
      automation: row.automation?.name || '',
      code: row.automation?.code || '',
      status: row.status,
      startedAt: row.startedAt ? new Date(row.startedAt).toLocaleString() : '',
      completedAt: row.completedAt ? new Date(row.completedAt).toLocaleString() : '',
      message: row.message || ''
    }));
    return makeReport('automations', filters, [
      { label: 'Runs', value: report.runs },
      { label: 'Success', value: report.success },
      { label: 'Failed', value: report.failed },
      { label: 'Success Rate', value: `${report.successRate}%` },
      { label: 'Most Active Automation', value: report.mostActiveAutomation }
    ], [
      { key: 'date', label: 'Date' },
      { key: 'automation', label: 'Automation' },
      { key: 'code', label: 'Code' },
      { key: 'status', label: 'Status' },
      { key: 'startedAt', label: 'Started' },
      { key: 'completedAt', label: 'Completed' },
      { key: 'message', label: 'Message' }
    ], rows, report.failureTrends.map((item) => ({ label: item.date, value: item.count })));
  }

  async attendanceAlertReport(filters) {
    const report = await attendanceAlertService.getAttendanceAlertReport(filters);
    const rows = report.rows.map((row) => ({
      date: dateValue(row.scheduledDate),
      sentDate: dateValue(row.sentDate),
      student: row.student?.name || '',
      course: row.student?.course?.name || '',
      batch: row.student?.batch?.name || '',
      guardian: row.guardian?.name || '',
      alertType: row.alertType,
      recipientType: row.recipientType,
      status: row.status
    }));
    return makeReport('attendance-alerts', filters, [
      { label: 'Generated Alerts', value: report.generatedAlerts },
      { label: 'Sent Alerts', value: report.sentAlerts },
      { label: 'Failed Alerts', value: report.failedAlerts },
      { label: 'Students Below 75%', value: report.studentsBelow75 },
      { label: 'Students Below 50%', value: report.studentsBelow50 },
      { label: 'Guardian Alerts Sent', value: report.guardianAlertsSent },
      { label: 'Student Alerts Sent', value: report.studentAlertsSent }
    ], [
      { key: 'date', label: 'Scheduled date' },
      { key: 'sentDate', label: 'Sent date' },
      { key: 'student', label: 'Student' },
      { key: 'course', label: 'Course' },
      { key: 'batch', label: 'Batch' },
      { key: 'guardian', label: 'Guardian' },
      { key: 'alertType', label: 'Alert type' },
      { key: 'recipientType', label: 'Recipients' },
      { key: 'status', label: 'Status' }
    ], rows, this.countChart(rows, 'status'));
  }

  async birthdayWishReport(filters) {
    const report = await birthdayWishService.getBirthdayWishReport(filters);
    const rows = report.rows.map((row) => ({
      birthdayDate: dateValue(row.birthdayDate),
      sentDate: dateValue(row.sentDate),
      student: row.student?.name || '',
      guardian: row.guardian?.name || '',
      course: row.student?.course?.name || '',
      recipientType: row.recipientType,
      status: row.status,
      channel: row.channel
    }));
    return makeReport('birthday-wishes', filters, [
      { label: 'Generated', value: report.generated },
      { label: 'Sent', value: report.sent },
      { label: 'Failed', value: report.failed },
      { label: 'Student Wishes', value: report.studentWishes },
      { label: 'Guardian Wishes', value: report.guardianWishes }
    ], [
      { key: 'birthdayDate', label: 'Birthday' },
      { key: 'sentDate', label: 'Sent date' },
      { key: 'student', label: 'Student' },
      { key: 'guardian', label: 'Guardian' },
      { key: 'course', label: 'Course' },
      { key: 'recipientType', label: 'Recipient type' },
      { key: 'status', label: 'Status' },
      { key: 'channel', label: 'Channel' }
    ], rows, this.countChart(rows, 'status'));
  }

  async overviewReport(filters) {
    const [leads, students, finance, overdue, campaigns, agents] = await Promise.all([
      this.leadReport(filters),
      this.studentReport(filters),
      this.financeReport(filters),
      this.overdueInstallmentReport(filters),
      this.campaignReport(filters),
      this.agentReport(filters)
    ]);
    const summary = [
      { label: 'Total leads', value: leads.summary[0]?.value || 0 },
      { label: 'Converted leads', value: leads.summary[1]?.value || 0 },
      { label: 'Active students', value: students.rows.filter((row) => row.status === 'active' || row.status === 'enrolled').length },
      { label: 'Total revenue', value: finance.summary.find((item) => item.label === 'Paid Amount')?.value || '0.00' },
      { label: 'Outstanding amount', value: finance.summary.find((item) => item.label === 'Balance')?.value || '0.00' },
      { label: 'Overdue installments', value: overdue.rows.length },
      { label: 'Campaign delivery rate', value: pct(campaigns.rows.reduce((sum, row) => sum + amount(row.delivered), 0), campaigns.rows.reduce((sum, row) => sum + amount(row.targeted), 0)) },
      { label: 'Agent conversion rate', value: agents.rows[0]?.conversionRate || '0%' }
    ];
    return makeReport('overview', filters, summary, [
      { key: 'metric', label: 'Metric' },
      { key: 'value', label: 'Value' }
    ], summary.map((item) => ({ metric: item.label, value: item.value })), []);
  }

  moneySummary(rows) {
    return [
      { label: 'Records', value: rows.length },
      { label: 'Total Amount', value: rows.reduce((sum, row) => sum + amount(row.amount), 0).toFixed(2) },
      { label: 'Paid Amount', value: rows.reduce((sum, row) => sum + amount(row.paidAmount), 0).toFixed(2) },
      { label: 'Balance', value: rows.reduce((sum, row) => sum + amount(row.balance), 0).toFixed(2) }
    ];
  }

  countChart(rows, key) {
    const map = new Map();
    rows.forEach((row) => map.set(row[key] || 'Unknown', (map.get(row[key] || 'Unknown') || 0) + 1));
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }
}

module.exports = new ReportService();
