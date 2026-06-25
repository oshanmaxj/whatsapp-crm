const { Op, fn, col } = require('sequelize');
const { CampaignRecipient, Lead, LeadSource, LeadStatus, Student, StudentFee, User } = require('../models');

class ReportService {
  dateWhere({ from, to } = {}) {
    if (!from && !to) return {};
    const range = {};
    if (from) range[Op.gte] = new Date(from);
    if (to) range[Op.lte] = new Date(`${to}T23:59:59.999Z`);
    return { createdAt: range };
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
}

module.exports = new ReportService();
