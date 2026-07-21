const { Op, fn, col, literal } = require('sequelize');
const {
  sequelize,
  AttendanceAlert,
  AttendanceRecord,
  Batch,
  BirthdayWish,
  ClassReminder,
  Contact,
  Conversation,
  FeeInstallment,
  Followup,
  Lead,
  LeadAssignment,
  LeadSource,
  LeadStatus,
  Message,
  Student,
  StudentGuardian,
  StudentFee,
  User,
  AppSetting,
  Automation,
  AutomationLog,
  WhatsAppTemplate
} = require('../models');
const logger = require('../config/logger');
const { isMissingTableError } = require('../utils/databaseError');

const RECENT_LIMIT = 5;
const ACTIVITY_DAYS = 7;

function startOfDay(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toNumber(value) {
  return Number(value || 0);
}

class DashboardService {
  async getSummary(actor) {
    if (!actor?.isSystemAdmin && !(actor?.permissions?.includes('dashboard.view_all') && actor?.permissions?.includes('dashboard.view_financial'))) return require('./dashboardAnalytics.service').scopedSummary(actor);
    const todayStart = startOfDay();
    const activityStart = startOfDay(addDays(todayStart, -(ACTIVITY_DAYS - 1)));

    const [
      totalContacts,
      totalLeads,
      activeChats,
      messagesToday,
      newContactsToday,
      newLeads,
      convertedLeads,
      feeReminderWidgets,
      classReminderWidgets,
      automationWidgets,
      attendanceAlertWidgets,
      birthdayWidgets,
      whatsappComplianceWidgets,
      leadsByStatus,
      leadsBySource,
      topAgents,
      recentConversations,
      recentLeads,
      activityRows
    ] = await Promise.all([
      Contact.count(),
      Lead.count(),
      Conversation.count({ where: { status: { [Op.in]: ['open', 'pending'] } } }),
      Message.count({ where: { createdAt: { [Op.gte]: todayStart } } }),
      Contact.count({ where: { createdAt: { [Op.gte]: todayStart } } }),
      Lead.count({
        include: [{ model: LeadStatus, as: 'status', where: { name: 'New' }, required: true }]
      }),
      Lead.count({
        include: [{ model: LeadStatus, as: 'status', where: { code: 'registered' }, required: true }]
      }),
      this.getFeeReminderWidgets(todayStart),
      this.getClassReminderWidgets(todayStart),
      this.getAutomationWidgets(todayStart),
      this.getAttendanceAlertWidgets(todayStart),
      this.getBirthdayWidgets(todayStart),
      this.getWhatsAppComplianceWidgets(),
      this.getLeadsByStatus(),
      this.getLeadsBySource(),
      this.getTopAgents(),
      this.getRecentConversations(),
      this.getRecentLeads(),
      this.getDailyMessageActivity(activityStart)
    ]);

    const monthStart=new Date(todayStart.getFullYear(),todayStart.getMonth(),1);
    const lostLeadsThisMonth=await Lead.count({where:{updatedAt:{[Op.gte]:monthStart}},include:[{model:LeadStatus,as:'status',where:{isLost:true},required:true}]});
    return {
      totals: {
        contacts: totalContacts,
        leads: totalLeads,
        activeChats,
        messagesToday,
        newContactsToday,
        newLeads,
        convertedLeads,
        newLeadsToday:await Lead.count({where:{createdAt:{[Op.gte]:todayStart}}}),lostLeadsThisMonth,conversionRate:totalLeads?Math.round(convertedLeads/totalLeads*1000)/10:0,
        installmentsDueToday: feeReminderWidgets.dueToday,
        upcomingInstallments: feeReminderWidgets.upcoming,
        overdueInstallments: feeReminderWidgets.overdue,
        collectionForecast: feeReminderWidgets.collectionForecast,
        classesToday: classReminderWidgets.classesToday,
        classRemindersPending: classReminderWidgets.pending,
        classRemindersSentToday: classReminderWidgets.sentToday,
        classReminderFailures: classReminderWidgets.failures,
        classReminderAutoSendEnabled: classReminderWidgets.autoSendEnabled,
        activeAutomations: automationWidgets.active,
        automationRunsToday: automationWidgets.todayRuns,
        automationSuccessRate: automationWidgets.successRate,
        automationFailedJobs: automationWidgets.failedJobs,
        absentToday: attendanceAlertWidgets.absentToday,
        attendanceAlertsPending: attendanceAlertWidgets.pending,
        lowAttendanceStudents: attendanceAlertWidgets.lowAttendanceStudents,
        attendanceAlertFailures: attendanceAlertWidgets.failures,
        birthdaysToday: birthdayWidgets.today,
        birthdayWishesSent: birthdayWidgets.sent,
        birthdayWishesPending: birthdayWidgets.pending,
        birthdayWishesFailed: birthdayWidgets.failed,
        approvedTemplates: whatsappComplianceWidgets.approved,
        pendingTemplates: whatsappComplianceWidgets.pending,
        rejectedTemplates: whatsappComplianceWidgets.rejected,
        qualityIssues: whatsappComplianceWidgets.qualityIssues
      },
      leadsByStatus,
      leadsBySource,
      topAgents,
      recentConversations: recentConversations.map(this.serializeConversation),
      recentLeads: recentLeads.map(this.serializeLead),
      dailyMessageActivity: this.fillDailyActivity(activityStart, activityRows)
    };
  }

  getRecentConversations() {
    return Conversation.findAll({
      include: [
        {
          model: Contact,
          as: 'contact',
          attributes: ['id', 'firstName', 'lastName', 'phone', 'email', 'company']
        },
        {
          model: Lead,
          as: 'lead',
          attributes: ['id', 'stage', 'priority', 'value']
        }
      ],
      order: [
        ['last_message_at', 'DESC NULLS LAST'],
        ['updated_at', 'DESC']
      ],
      limit: RECENT_LIMIT
    });
  }

  getRecentLeads() {
    return Lead.findAll({
      include: [
        {
          model: Contact,
          as: 'contact',
          attributes: ['id', 'firstName', 'lastName', 'phone', 'email', 'company']
        },
        {
          model: LeadStatus,
          as: 'status',
          attributes: ['id', 'name']
        },
        {
          model: LeadSource,
          as: 'source',
          attributes: ['id', 'name']
        }
      ],
      order: [['created_at', 'DESC']],
      limit: RECENT_LIMIT
    });
  }

  getDailyMessageActivity(activityStart) {
    return Message.findAll({
      attributes: [
        [fn('date', col('created_at')), 'date'],
        [fn('count', col('id')), 'total'],
        [fn('sum', literal("CASE WHEN direction = 'inbound' THEN 1 ELSE 0 END")), 'inbound'],
        [fn('sum', literal("CASE WHEN direction = 'outbound' THEN 1 ELSE 0 END")), 'outbound']
      ],
      where: {
        createdAt: {
          [Op.gte]: activityStart
        }
      },
      group: [fn('date', col('created_at'))],
      order: [[fn('date', col('created_at')), 'ASC']],
      raw: true
    });
  }

  async getFeeReminderWidgets(todayStart = startOfDay()) {
    const today = formatDateKey(todayStart);
    const upcomingEnd = formatDateKey(addDays(todayStart, 7));
    const activeWhere = { status: { [Op.notIn]: ['paid', 'cancelled'] } };
    const [dueToday, upcoming, overdue, forecastRows] = await Promise.all([
      FeeInstallment.count({ where: { ...activeWhere, dueDate: today } }),
      FeeInstallment.count({ where: { ...activeWhere, dueDate: { [Op.gt]: today, [Op.lte]: upcomingEnd } } }),
      FeeInstallment.count({ where: { ...activeWhere, dueDate: { [Op.lt]: today } } }),
      FeeInstallment.findAll({
        where: { ...activeWhere, dueDate: { [Op.gte]: today, [Op.lte]: upcomingEnd } },
        include: [{ model: StudentFee, as: 'fee' }]
      })
    ]);
    return {
      dueToday,
      upcoming,
      overdue,
      collectionForecast: forecastRows.reduce((sum, row) => sum + Math.max(toNumber(row.amount) - toNumber(row.paidAmount), 0), 0).toFixed(2)
    };
  }

  async getWhatsAppComplianceWidgets() {
    const [approved, pending, rejected, qualityIssues] = await Promise.all([
      WhatsAppTemplate.count({ where: { status: 'APPROVED' } }),
      WhatsAppTemplate.count({ where: { status: 'PENDING' } }),
      WhatsAppTemplate.count({ where: { status: 'REJECTED' } }),
      WhatsAppTemplate.count({ where: { qualityRating: { [Op.in]: ['LOW', 'UNKNOWN'] } } })
    ]);
    return { approved, pending, rejected, qualityIssues };
  }

  async getAutomationWidgets(todayStart = startOfDay()) {
    const [active, todayRuns, successfulRuns, failedJobs, totalRuns] = await Promise.all([
      Automation.count({ where: { enabled: true } }),
      AutomationLog.count({ where: { startedAt: { [Op.gte]: todayStart } } }),
      AutomationLog.count({ where: { status: 'success' } }),
      AutomationLog.count({ where: { status: 'failed' } }),
      AutomationLog.count({ where: { status: { [Op.in]: ['success', 'failed'] } } })
    ]);
    return {
      active,
      todayRuns,
      failedJobs,
      successRate: totalRuns ? Math.round((successfulRuns / totalRuns) * 10000) / 100 : 0
    };
  }

  async getAttendanceAlertWidgets(todayStart = startOfDay()) {
    const today = formatDateKey(todayStart);
    const [absentToday, pending, failures, records] = await Promise.all([
      AttendanceRecord.count({ where: { attendanceDate: today, status: 'absent' } }),
      AttendanceAlert.count({ where: { status: 'pending' } }),
      AttendanceAlert.count({ where: { status: 'failed', updatedAt: { [Op.gte]: todayStart } } }),
      AttendanceRecord.findAll({ attributes: ['studentId', 'status'] })
    ]);
    const studentRecords = new Map();
    records.forEach((record) => {
      const rows = studentRecords.get(String(record.studentId)) || [];
      rows.push(record);
      studentRecords.set(String(record.studentId), rows);
    });
    const lowAttendanceStudents = Array.from(studentRecords.values()).filter((rows) => {
      const attended = rows.filter((row) => ['present', 'late'].includes(row.status)).length;
      return rows.length > 0 && (attended / rows.length) * 100 < 75;
    }).length;
    return { absentToday, pending, failures, lowAttendanceStudents };
  }

  async getBirthdayWidgets(todayStart = startOfDay()) {
    const monthDay = formatDateKey(todayStart).slice(5);
    const [students, guardians] = await Promise.all([
      Student.findAll({
        where: { status: { [Op.in]: ['enrolled', 'active'] }, dateOfBirth: { [Op.ne]: null } },
        attributes: ['dateOfBirth']
      }),
      StudentGuardian.findAll({
        where: { dateOfBirth: { [Op.ne]: null } },
        attributes: ['dateOfBirth'],
        include: [{ model: Student, as: 'student', where: { status: { [Op.in]: ['enrolled', 'active'] } }, attributes: [], required: true }]
      })
    ]);
    const today = [...students, ...guardians].filter((row) => String(row.dateOfBirth || '').slice(5) === monthDay).length;

    try {
      const [sent, pending, failed] = await Promise.all([
        BirthdayWish.count({ where: { status: 'sent', sentDate: { [Op.gte]: todayStart } } }),
        BirthdayWish.count({ where: { status: 'pending' } }),
        BirthdayWish.count({ where: { status: 'failed', updatedAt: { [Op.gte]: todayStart } } })
      ]);
      return { today, sent, pending, failed };
    } catch (error) {
      if (!isMissingTableError(error, 'birthday_wishes')) throw error;
      logger.warn('birthday_wishes_table_missing', {
        context: 'dashboard_widgets'
      });
      return { today, sent: 0, pending: 0, failed: 0 };
    }
  }

  async getClassReminderWidgets(todayStart = startOfDay()) {
    const today = formatDateKey(todayStart);
    const tomorrow = formatDateKey(addDays(todayStart, 1));
    const [settingsRow, classesToday, pending, sentToday, failures] = await Promise.all([
      AppSetting.findOne({ where: { namespace: 'class_reminders', key: 'automation' } }),
      Batch.count({
        where: {
          status: { [Op.in]: ['upcoming', 'active'] },
          [Op.or]: [
            { startDate: today },
            { startDate: { [Op.lte]: today }, endDate: { [Op.gte]: today } }
          ]
        }
      }),
      ClassReminder.count({ where: { status: 'pending', scheduleDate: { [Op.between]: [today, tomorrow] } } }),
      ClassReminder.count({ where: { status: 'sent', sentTime: { [Op.gte]: todayStart } } }),
      ClassReminder.count({ where: { status: 'failed', updatedAt: { [Op.gte]: todayStart } } })
    ]);
    return { classesToday, pending, sentToday, failures, autoSendEnabled: settingsRow?.value?.class_reminder_auto_send_enabled === true };
  }

  async getLeadsByStatus() {
    const rows = await Lead.findAll({
      attributes: [[fn('count', col('Lead.id')), 'count']],
      include: [{ model: LeadStatus, as: 'status', attributes: ['id', 'name'], required: true }],
      group: ['status.id', 'status.name'],
      raw: true
    });

    return rows.map((row) => ({
      status: row['status.name'],
      count: toNumber(row.count)
    }));
  }

  async getLeadsBySource() {
    const rows = await Lead.findAll({
      attributes: [[fn('count', col('Lead.id')), 'count']],
      include: [{ model: LeadSource, as: 'source', attributes: ['id', 'name'], required: true }],
      group: ['source.id', 'source.name'],
      raw: true
    });

    return rows.map((row) => ({
      source: row['source.name'],
      count: toNumber(row.count)
    }));
  }

  async getTopAgents() {
    const rows = await Lead.findAll({
      attributes: ['ownerId', [fn('count', col('Lead.id')), 'leadCount']],
      where: { ownerId: { [Op.ne]: null } },
      include: [{ model: User, as: 'owner', attributes: ['id', 'firstName', 'lastName', 'email'], required: true }],
      group: ['Lead.owner_id', 'owner.id', 'owner.first_name', 'owner.last_name', 'owner.email'],
      order: [[literal('"leadCount"'), 'DESC']],
      limit: 5,
      raw: true
    });

    return rows.map((row) => ({
      agent: {
        id: row['owner.id'],
        firstName: row['owner.firstName'],
        lastName: row['owner.lastName'],
        name: [row['owner.firstName'], row['owner.lastName']].filter(Boolean).join(' ') || row['owner.email'],
        email: row['owner.email']
      },
      assignedLeadCount: toNumber(row.leadCount)
    }));
  }

  fillDailyActivity(activityStart, activityRows) {
    const rowsByDate = new Map(
      activityRows.map((row) => [
        typeof row.date === 'string' ? row.date : formatDateKey(row.date),
        row
      ])
    );

    return Array.from({ length: ACTIVITY_DAYS }, (_, index) => {
      const date = addDays(activityStart, index);
      const dateKey = formatDateKey(date);
      const row = rowsByDate.get(dateKey);

      return {
        date: dateKey,
        total: toNumber(row?.total),
        inbound: toNumber(row?.inbound),
        outbound: toNumber(row?.outbound)
      };
    });
  }

  serializeConversation(conversation) {
    return {
      id: conversation.id,
      status: conversation.status,
      summary: conversation.summary,
      lastMessageAt: conversation.lastMessageAt,
      updatedAt: conversation.updatedAt,
      contact: conversation.contact
        ? {
            id: conversation.contact.id,
            firstName: conversation.contact.firstName,
            lastName: conversation.contact.lastName,
            phone: conversation.contact.phone,
            email: conversation.contact.email,
            company: conversation.contact.company
          }
        : null,
      lead: conversation.lead
        ? {
            id: conversation.lead.id,
            stage: conversation.lead.stage,
            priority: conversation.lead.priority,
            value: conversation.lead.value
          }
        : null
    };
  }

  serializeLead(lead) {
    return {
      id: lead.id,
      stage: lead.stage,
      priority: lead.priority,
      value: lead.value,
      aiScore: lead.aiScore,
      qualificationStatus: lead.qualificationStatus,
      sentiment: lead.sentiment,
      nextFollowupAt: lead.nextFollowupAt,
      createdAt: lead.createdAt,
      contact: lead.contact
        ? {
            id: lead.contact.id,
            firstName: lead.contact.firstName,
            lastName: lead.contact.lastName,
            phone: lead.contact.phone,
            email: lead.contact.email,
            company: lead.contact.company
          }
        : null,
      status: lead.status
        ? {
            id: lead.status.id,
            name: lead.status.name
          }
        : null,
      source: lead.source
        ? {
            id: lead.source.id,
            name: lead.source.name
          }
        : null
    };
  }
}

module.exports = new DashboardService();
