const { fn, col } = require('sequelize');
const { CampaignRecipient, Lead, LeadSource, LeadStatus, Student, StudentFee, User } = require('../models');

class ReportService {
  async summary() {
    const [leads, students, revenue, campaign, agents] = await Promise.all([
      LeadStatus.findAll({ include: [{ model: Lead, as: 'leads', attributes: [] }], attributes: ['name', [fn('count', col('leads.id')), 'count']], group: ['LeadStatus.id'], raw: true }),
      Student.findAll({ attributes: ['status', [fn('count', col('id')), 'count']], group: ['status'], raw: true }),
      StudentFee.findAll({ attributes: [[fn('sum', col('total_amount')), 'total'], [fn('sum', col('paid_amount')), 'paid']], raw: true }),
      CampaignRecipient.findAll({ attributes: ['status', [fn('count', col('id')), 'count']], group: ['status'], raw: true }),
      User.findAll({ attributes: ['id', 'firstName', 'lastName', 'email'], limit: 20 })
    ]);
    return { leads, students, revenue: revenue[0] || {}, campaign, agents };
  }
}

module.exports = new ReportService();
