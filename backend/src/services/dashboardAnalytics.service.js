const { Op, QueryTypes } = require('sequelize');
const { sequelize, User, Role, Lead, LeadStatus, Conversation, Message, Followup, AgentCommission, AccountingTransaction, PaymentSlip, PaymentReceipt, StudentFee, Student, Batch, Course, AttendanceRecord, Certificate } = require('../models');

function has(actor, permission) { return actor?.isSystemAdmin || actor?.permissions?.includes(permission); }
function colomboDay(date = new Date()) {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.BUSINESS_TIMEZONE || 'Asia/Colombo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const start = new Date(`${key}T00:00:00+05:30`);
  return { key, start, end: new Date(start.getTime() + 86400000) };
}
function rangeDates(range = 'month', from, to) {
  if (range === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(from || '') && /^\d{4}-\d{2}-\d{2}$/.test(to || '')) return { start: new Date(`${from}T00:00:00+05:30`), end: new Date(new Date(`${to}T00:00:00+05:30`).getTime() + 86400000) };
  const day = colomboDay();
  if (range === 'today') return day;
  if (range === 'week') { const start = new Date(day.start); start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); return { start, end: day.end }; }
  const start = new Date(day.start); start.setDate(1); return { start, end: day.end };
}
function scoreAndRank(rows) {
  const maxRevenue = Math.max(1, ...rows.map((row) => row.revenueAttributed));
  rows.forEach((row) => { row.score = Math.round((row.conversionRate * .45 + row.followupCompletionRate * .25 + Math.min(row.uniqueConversations, 20) + (row.revenueAttributed / maxRevenue * 10)) * 100) / 100; });
  rows.sort((a, b) => b.score - a.score || b.convertedLeads - a.convertedLeads || a.agent.name.localeCompare(b.agent.name));
  rows.forEach((row, index) => { row.rank = index && row.score === rows[index - 1].score ? rows[index - 1].rank : index + 1; });
  return rows;
}

class DashboardAnalyticsService {
  async accountingSummary(actor) {
    const day = colomboDay(); const monthKey = `${day.key.slice(0, 7)}-01`; const monthStart = new Date(`${monthKey}T00:00:00+05:30`);
    const sum = async (type, startKey) => Number(await AccountingTransaction.sum('amount', { where: { type, date: { [Op.gte]: startKey, [Op.lte]: day.key } } }) || 0);
    const [incomeToday, incomeMonth, expensesMonth, pendingFees, paymentVerifications, receiptsGenerated, reversals, commissionsPending] = await Promise.all([
      sum('income', day.key), sum('income', monthKey), sum('expense', monthKey), StudentFee.sum('balance', { where: { status: { [Op.in]: ['pending', 'partial', 'overdue'] } } }),
      PaymentSlip.count({ where: { verificationStatus: 'PENDING' } }), PaymentReceipt.count({ where: { receiptDate: { [Op.gte]: monthStart }, status: 'ACTIVE' } }),
      PaymentReceipt.count({ where: { receiptDate: { [Op.gte]: monthStart }, status: { [Op.in]: ['VOID', 'REVERSED'] } } }), AgentCommission.sum('commissionAmount', { where: { status: 'pending' } })
    ]);
    return { scope: 'accounting', availability: { financial: true, education: false, leaderboard: false }, totals: { incomeToday, incomeMonth, expensesMonth, pendingFees: Number(pendingFees || 0), paymentVerifications, receiptsGenerated, reversals, commissionsPending: Number(commissionsPending || 0) }, recentConversations: [], recentLeads: [], dailyMessageActivity: [], leadsByStatus: [], leadsBySource: [], topAgents: [] };
  }

  async educationSummary(actor) {
    const day = colomboDay(); const date = day.key;
    const trainerWhere = actor?.isSystemAdmin || actor?.permissions?.includes('dashboard.view_all') ? {} : { assignedTrainerId: actor.id };
    const [activeStudents, activeBatches, activeCourses, upcomingClasses, attendanceToday, feesDue, certificatesPending] = await Promise.all([
      actor.permissions?.includes('students.view') ? Student.count({ where: { status: { [Op.in]: ['enrolled', 'active'] } } }) : null,
      actor.permissions?.includes('batches.view') ? Batch.count({ where: { ...trainerWhere, status: 'active' } }) : null,
      actor.permissions?.includes('courses.view') ? Course.count({ where: { status: 'active' } }) : null,
      actor.permissions?.includes('batches.view') ? Batch.count({ where: { ...trainerWhere, status: 'upcoming' } }) : null,
      actor.permissions?.includes('attendance.view') ? AttendanceRecord.count({ where: { attendanceDate: date } }) : null,
      actor.permissions?.includes('fees.view') ? StudentFee.sum('balance', { where: { status: { [Op.in]: ['pending', 'partial', 'overdue'] } } }) : null,
      actor.permissions?.includes('certificates.view') ? Certificate.count({ where: { status: 'draft' } }) : null
    ]);
    return { scope: 'education', availability: { financial: actor?.permissions?.includes('fees.view') || false, education: true, leaderboard: false }, totals: { activeStudents, activeBatches, activeCourses, upcomingClasses, attendanceToday, feesDue: feesDue == null ? undefined : Number(feesDue), certificatesPending }, recentConversations: [], recentLeads: [], dailyMessageActivity: [], leadsByStatus: [], leadsBySource: [], topAgents: [] };
  }

  async agentIds(actor) {
    if (has(actor, 'dashboard.view_all')) return null;
    if (!has(actor, 'dashboard.view_team')) return [Number(actor.id)];
    const user = await User.findByPk(actor.id, { include: [{ model: Role, as: 'roles', attributes: ['id', 'name'] }] });
    const teamRoleIds = (user?.roles || []).filter((role) => !['admin', 'manager', 'agent', 'accountant', 'lecturer', 'marketing'].includes(String(role.name).toLowerCase())).map((role) => role.id);
    if (!teamRoleIds.length) return [Number(actor.id)];
    const rows = await sequelize.query('SELECT DISTINCT user_id FROM user_roles WHERE role_id IN (:roleIds)', { replacements: { roleIds: teamRoleIds }, type: QueryTypes.SELECT }).catch(() => []);
    return [...new Set([Number(actor.id), ...rows.map((row) => Number(row.user_id)).filter(Boolean)])];
  }

  async scopedSummary(actor) {
    if (!has(actor, 'dashboard.view_own') && !has(actor, 'dashboard.view_team') && !has(actor, 'dashboard.view_all')) throw Object.assign(new Error('Dashboard access is not available.'), { status: 403, code: 'DASHBOARD_FORBIDDEN' });
    const roles = (actor.roles || []).map((role) => String(role).toLowerCase());
    if (roles.includes('accountant') && actor.permissions?.includes('accounting.view')) return this.accountingSummary(actor);
    if (roles.includes('lecturer') && actor.permissions?.some((permission) => permission.startsWith('lms.') || permission === 'courses.view')) return this.educationSummary(actor);
    const ids = await this.agentIds(actor);
    const ownerWhere = ids ? { ownerId: { [Op.in]: ids } } : {};
    const chatWhere = ids ? { assignedUserId: { [Op.in]: ids } } : {};
    const messageWhere = ids ? { sentByUserId: { [Op.in]: ids } } : {};
    const today = colomboDay();
    const [leads, newToday, converted, openChats, awaitingReply, repliesToday, uniqueReplies, followupsDue, missedFollowups] = await Promise.all([
      Lead.count({ where: ownerWhere }), Lead.count({ where: { ...ownerWhere, createdAt: { [Op.gte]: today.start, [Op.lt]: today.end } } }),
      Lead.count({ where: ownerWhere, include: [{ model: LeadStatus, as: 'status', where: { code: 'registered' }, required: true }] }),
      Conversation.count({ where: { ...chatWhere, status: { [Op.in]: ['open', 'pending'] } } }),
      Conversation.count({ where: { ...chatWhere, status: { [Op.in]: ['open', 'pending'] }, [Op.and]: sequelize.literal(`EXISTS (SELECT 1 FROM messages lm WHERE lm.conversation_id = "Conversation".id AND lm.deleted_at IS NULL AND lm.direction = 'inbound' AND NOT EXISTS (SELECT 1 FROM messages newer WHERE newer.conversation_id = lm.conversation_id AND newer.deleted_at IS NULL AND newer.created_at > lm.created_at))`) } }),
      Message.count({ where: { ...messageWhere, direction: 'outbound', createdAt: { [Op.gte]: today.start, [Op.lt]: today.end } } }),
      Message.count({ distinct: true, col: 'conversationId', where: { ...messageWhere, direction: 'outbound', createdAt: { [Op.gte]: today.start, [Op.lt]: today.end } } }),
      Followup.count({ where: { ...(ids ? { assignedTo: { [Op.in]: ids } } : {}), status: 'pending', dueDate: { [Op.gte]: today.start, [Op.lt]: today.end } } }),
      Followup.count({ where: { ...(ids ? { assignedTo: { [Op.in]: ids } } : {}), status: 'pending', dueDate: { [Op.lt]: today.start } } })
    ]);
    const financial = has(actor, 'dashboard.view_financial') || ['commission.view_own', 'commission.view_team', 'commission.view_all'].some((permission) => actor?.permissions?.includes(permission));
    const commissions = financial ? await AgentCommission.findAll({ attributes: ['status', 'commissionAmount', 'grossPaymentAmount'], where: ids ? { agentUserId: { [Op.in]: ids } } : {}, raw: true }).catch(() => []) : null;
    return {
      scope: ids?.length === 1 ? 'own' : ids ? 'team' : 'all',
      availability: { financial, education: false, leaderboard: has(actor, 'dashboard.view_agent_ranking') },
      totals: { leads, newLeadsToday: newToday, convertedLeads: converted, conversionRate: leads ? Math.round(converted * 1000 / leads) / 10 : 0, activeChats: openChats, chatsAwaitingReply: awaitingReply, messagesToday: repliesToday, uniqueConversationsRepliedToday: uniqueReplies, followupsDueToday: followupsDue, missedFollowups, ...(financial ? { revenueAttributed: commissions.reduce((sum, row) => sum + Number(row.grossPaymentAmount || 0), 0), commission: commissions.reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0), pendingCommission: commissions.filter((row) => row.status === 'pending').reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0), paidCommission: commissions.filter((row) => row.status === 'paid').reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0) } : {}) },
      recentConversations: [], recentLeads: [], dailyMessageActivity: [], leadsByStatus: [], leadsBySource: [], topAgents: []
    };
  }

  async leaderboard(actor, query = {}) {
    if (!has(actor, 'dashboard.view_agent_ranking')) throw Object.assign(new Error('Agent ranking permission is required.'), { status: 403, code: 'DASHBOARD_RANKING_FORBIDDEN' });
    const permitted = await this.agentIds(actor);
    const { start, end } = rangeDates(query.range, query.from, query.to);
    const permissionClause = permitted ? 'AND u.id IN (:permitted)' : '';
    const rawRows = await sequelize.query(`
      SELECT u.id, u.first_name, u.last_name, u.email,
        COALESCE(l.assigned, 0) AS assigned, COALESCE(l.converted, 0) AS converted,
        COALESCE(m.replies, 0) AS replies, COALESCE(m.unique_conversations, 0) AS unique_conversations,
        COALESCE(c.open_chats, 0) AS open_chats, COALESCE(f.followups, 0) AS followups,
        COALESCE(f.completed, 0) AS completed, COALESCE(ac.revenue, 0) AS revenue,
        COALESCE(ac.commission, 0) AS commission
      FROM users u
      LEFT JOIN (SELECT lead.owner_id,
          COUNT(*) AS assigned,
          SUM(CASE WHEN ls.code = 'registered' THEN 1 ELSE 0 END) AS converted
        FROM leads lead LEFT JOIN lead_statuses ls ON ls.id = lead.status_id
        WHERE lead.deleted_at IS NULL AND lead.created_at >= :start AND lead.created_at < :end GROUP BY lead.owner_id) l ON l.owner_id = u.id
      LEFT JOIN (SELECT sent_by_user_id,
          COUNT(*) AS replies, COUNT(DISTINCT conversation_id) AS unique_conversations
        FROM messages WHERE deleted_at IS NULL AND direction = 'outbound' AND created_at >= :start AND created_at < :end GROUP BY sent_by_user_id) m ON m.sent_by_user_id = u.id
      LEFT JOIN (SELECT assigned_user_id, COUNT(*) AS open_chats FROM conversations WHERE deleted_at IS NULL AND status IN ('open','pending') GROUP BY assigned_user_id) c ON c.assigned_user_id = u.id
      LEFT JOIN (SELECT assigned_to, COUNT(*) AS followups,
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed
        FROM followups WHERE deleted_at IS NULL AND due_date >= :start AND due_date < :end GROUP BY assigned_to) f ON f.assigned_to = u.id
      LEFT JOIN (SELECT agent_user_id, SUM(gross_payment_amount) AS revenue, SUM(commission_amount) AS commission
        FROM agent_commissions WHERE calculated_at >= :start AND calculated_at < :end GROUP BY agent_user_id) ac ON ac.agent_user_id = u.id
      WHERE u.deleted_at IS NULL AND u.status = 'active' AND u.is_system_admin = FALSE ${permissionClause}
    `, { replacements: { start, end, permitted }, type: QueryTypes.SELECT });
    const rows = rawRows.map((row) => {
      const assigned = Number(row.assigned); const converted = Number(row.converted); const followups = Number(row.followups); const completed = Number(row.completed);
      return { agent: { id: row.id, name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email }, assignedLeads: assigned, convertedLeads: converted, conversionRate: assigned ? converted / assigned * 100 : 0, messagesReplied: Number(row.replies), uniqueConversations: Number(row.unique_conversations), openChats: Number(row.open_chats), revenueAttributed: Number(row.revenue), commissionEarned: Number(row.commission), followupCompletionRate: followups ? completed / followups * 100 : 0 };
    });
    scoreAndRank(rows);
    const page = Math.max(Number(query.page) || 1, 1); const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
    return { rows: rows.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: rows.length, pages: Math.ceil(rows.length / limit) }, range: { start, end }, formula: '45% conversion rate + 25% follow-up completion + up to 20 points unique conversations + 10% normalized attributed revenue' };
  }
}

module.exports = new DashboardAnalyticsService();
module.exports.scoreAndRank = scoreAndRank;
module.exports.rangeDates = rangeDates;
