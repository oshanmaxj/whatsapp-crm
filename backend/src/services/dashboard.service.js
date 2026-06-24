const { Op, fn, col, literal } = require('sequelize');
const {
  sequelize,
  Contact,
  Conversation,
  Followup,
  Lead,
  LeadAssignment,
  LeadSource,
  LeadStatus,
  Message,
  User
} = require('../models');

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
  async getSummary() {
    const todayStart = startOfDay();
    const activityStart = startOfDay(addDays(todayStart, -(ACTIVITY_DAYS - 1)));

    const [
      totalContacts,
      totalLeads,
      activeChats,
      messagesToday,
      newContactsToday,
      pendingFollowups,
      newLeads,
      convertedLeads,
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
      Followup.count({ where: { status: 'pending' } }),
      Lead.count({
        include: [{ model: LeadStatus, as: 'status', where: { name: 'New' }, required: true }]
      }),
      Lead.count({
        include: [{ model: LeadStatus, as: 'status', where: { name: 'Converted' }, required: true }]
      }),
      this.getLeadsByStatus(),
      this.getLeadsBySource(),
      this.getTopAgents(),
      this.getRecentConversations(),
      this.getRecentLeads(),
      this.getDailyMessageActivity(activityStart)
    ]);

    return {
      totals: {
        contacts: totalContacts,
        leads: totalLeads,
        activeChats,
        messagesToday,
        newContactsToday,
        pendingFollowups,
        newLeads,
        convertedLeads
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
