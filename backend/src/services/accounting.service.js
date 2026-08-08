const { Op, fn, col } = require('sequelize');
const {
  AccountingCategory, AccountingTransaction, Campaign, Course, PaymentReceipt, Student, User, sequelize
} = require('../models');
const accountingEpochService = require('./accountingEpoch.service');

const TYPES = ['income', 'expense'];
const METHODS = ['cash', 'bank', 'card', 'online', 'other'];

function dateWhere({ fromDate, toDate } = {}) {
  if (!fromDate && !toDate) return {};
  return {
    date: {
      ...(fromDate ? { [Op.gte]: fromDate } : {}),
      ...(toDate ? { [Op.lte]: toDate } : {})
    }
  };
}

function amount(value) {
  return Number(value || 0);
}

class AccountingService {
  includes() {
    return [
      { model: AccountingCategory, as: 'category', attributes: ['id', 'name', 'type'] },
      { model: Student, as: 'student', attributes: ['id', 'studentNo', 'name'], required: false },
      { model: Course, as: 'course', attributes: ['id', 'code', 'name'], required: false },
      { model: Campaign, as: 'campaign', attributes: ['id', 'name'], required: false },
      { model: User, as: 'creator', attributes: ['id', 'firstName', 'lastName', 'email'], required: false },
      { model: PaymentReceipt, as: 'receipts', required: false }
    ];
  }

  async transactionWhere(filters = {}, actor = null) {
    const reporting = await accountingEpochService.scopeWhere(filters.period || 'current', actor);
    return {
      ...reporting.where,
      ...dateWhere(filters),
      ...(filters.type && TYPES.includes(filters.type) ? { type: filters.type } : {}),
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
      ...(filters.paymentMethod && METHODS.includes(filters.paymentMethod) ? { paymentMethod: filters.paymentMethod } : {})
    };
  }

  async listTransactions(filters = {}, actor = null) {
    return AccountingTransaction.findAll({
      where: await this.transactionWhere(filters, actor),
      include: this.includes(),
      order: [['date', 'DESC'], ['id', 'DESC']],
      limit: Math.min(Number(filters.limit) || 1000, 5000)
    });
  }

  async getTransaction(id, actor = null, period = 'current') {
    const reporting = await accountingEpochService.scopeWhere(period, actor);
    const row = await AccountingTransaction.findOne({ where: { id, ...reporting.where }, include: this.includes() });
    if (!row) throw Object.assign(new Error('Accounting transaction not found'), { status: 404 });
    return row;
  }

  async validateTransaction(payload, existing = null) {
    const type = payload.type ?? existing?.type;
    const categoryId = payload.categoryId ?? existing?.categoryId;
    const paymentMethod = payload.paymentMethod ?? existing?.paymentMethod ?? 'cash';
    const transactionAmount = payload.amount ?? existing?.amount;
    const transactionDate = payload.date ?? existing?.date;
    if (!TYPES.includes(type)) throw Object.assign(new Error('Type must be income or expense'), { status: 422 });
    if (!transactionDate) throw Object.assign(new Error('Transaction date is required'), { status: 422 });
    if (!Number.isFinite(Number(transactionAmount)) || Number(transactionAmount) <= 0) {
      throw Object.assign(new Error('Amount must be greater than zero'), { status: 422 });
    }
    if (!METHODS.includes(paymentMethod)) throw Object.assign(new Error('Invalid payment method'), { status: 422 });
    const category = await AccountingCategory.findOne({ where: { id: categoryId, type } });
    if (!category) throw Object.assign(new Error('Select a category matching the transaction type'), { status: 422 });
  }

  async createTransaction(payload, userId) {
    await this.validateTransaction(payload);
    const row = await AccountingTransaction.create({
      type: payload.type,
      date: payload.date,
      amount: payload.amount,
      categoryId: payload.categoryId,
      paymentMethod: payload.paymentMethod || 'cash',
      referenceNo: payload.referenceNo || null,
      description: payload.description || null,
      relatedStudentId: payload.relatedStudentId || null,
      relatedCourseId: payload.relatedCourseId || null,
      relatedCampaignId: payload.relatedCampaignId || null,
      createdBy: userId || null
      , sourceEventAt: payload.sourceEventAt ? new Date(payload.sourceEventAt) : new Date()
      , sourceType: 'manual'
    });
    return AccountingTransaction.findByPk(row.id, { include: this.includes() });
  }

  async updateTransaction(id, payload) {
    const row = await this.getTransaction(id);
    if (await PaymentReceipt.count({ where: { paymentId: id } })) {
      throw Object.assign(new Error('A receipted payment is immutable; reverse it and create a corrected payment'), { status: 409, code: 'RECEIPTED_PAYMENT_IMMUTABLE' });
    }
    await this.validateTransaction(payload, row);
    await row.update({
      type: payload.type ?? row.type,
      date: payload.date ?? row.date,
      amount: payload.amount ?? row.amount,
      categoryId: payload.categoryId ?? row.categoryId,
      paymentMethod: payload.paymentMethod ?? row.paymentMethod,
      referenceNo: payload.referenceNo !== undefined ? (payload.referenceNo || null) : row.referenceNo,
      description: payload.description !== undefined ? (payload.description || null) : row.description,
      relatedStudentId: payload.relatedStudentId !== undefined ? (payload.relatedStudentId || null) : row.relatedStudentId,
      relatedCourseId: payload.relatedCourseId !== undefined ? (payload.relatedCourseId || null) : row.relatedCourseId,
      relatedCampaignId: payload.relatedCampaignId !== undefined ? (payload.relatedCampaignId || null) : row.relatedCampaignId
      , sourceEventAt: row.sourceEventAt
    });
    return this.getTransaction(id);
  }

  async deleteTransaction(id) {
    const row = await this.getTransaction(id);
    if (await PaymentReceipt.count({ where: { paymentId: id } })) {
      throw Object.assign(new Error('A receipted payment cannot be deleted; reverse it instead'), { status: 409, code: 'RECEIPTED_PAYMENT_IMMUTABLE' });
    }
    await row.destroy();
    return { deleted: true, id };
  }

  async listCategories(filters = {}) {
    return AccountingCategory.findAll({
      where: {
        ...(filters.type && TYPES.includes(filters.type) ? { type: filters.type } : {}),
        ...(['true', '1'].includes(String(filters.activeOnly).toLowerCase()) ? { isActive: true } : {})
      },
      order: [['type', 'ASC'], ['name', 'ASC']]
    });
  }

  async createCategory(payload) {
    const name = String(payload.name || '').trim();
    if (!name || !TYPES.includes(payload.type)) throw Object.assign(new Error('Name and valid category type are required'), { status: 422 });
    const duplicate = await AccountingCategory.findOne({
      where: { type: payload.type, [Op.and]: [sequelize.where(fn('lower', col('name')), name.toLowerCase())] }
    });
    if (duplicate) throw Object.assign(new Error('Category already exists'), { status: 409 });
    return AccountingCategory.create({ name, type: payload.type, description: payload.description || null, isActive: payload.isActive !== false });
  }

  async updateCategory(id, payload) {
    const row = await AccountingCategory.findByPk(id);
    if (!row) throw Object.assign(new Error('Accounting category not found'), { status: 404 });
    const type = payload.type ?? row.type;
    if (!TYPES.includes(type)) throw Object.assign(new Error('Invalid category type'), { status: 422 });
    if (type !== row.type && await AccountingTransaction.count({ where: { categoryId: id } })) {
      throw Object.assign(new Error('A category with transactions cannot change type'), { status: 409 });
    }
    if (payload.name) {
      const name = String(payload.name).trim();
      const duplicate = await AccountingCategory.findOne({
        where: {
          id: { [Op.ne]: id },
          type,
          [Op.and]: [sequelize.where(fn('lower', col('name')), name.toLowerCase())]
        }
      });
      if (duplicate) throw Object.assign(new Error('Category already exists'), { status: 409 });
    }
    await row.update({
      name: payload.name ? String(payload.name).trim() : row.name,
      type,
      description: payload.description !== undefined ? payload.description : row.description,
      isActive: payload.isActive ?? row.isActive
    });
    return row;
  }

  async deleteCategory(id) {
    const row = await AccountingCategory.findByPk(id);
    if (!row) throw Object.assign(new Error('Accounting category not found'), { status: 404 });
    const used = await AccountingTransaction.count({ where: { categoryId: id } });
    if (used) {
      await row.update({ isActive: false });
      return { deleted: false, deactivated: true, id, transactionCount: used };
    }
    await row.destroy();
    return { deleted: true, id };
  }

  async summary(filters = {}, actor = null) {
    const reporting = await accountingEpochService.scopeWhere(filters.period || 'current', actor);
    const where = { ...reporting.where, ...dateWhere(filters) };
    const start = new Date();
    start.setDate(1);
    const monthStart = start.toISOString().slice(0, 10);
    const [totals, monthTotals, recentTransactions] = await Promise.all([
      AccountingTransaction.findAll({ where, attributes: ['type', [fn('sum', col('amount')), 'total']], group: ['type'], raw: true }),
      AccountingTransaction.findAll({ where: { ...reporting.where, date: { [Op.gte]: monthStart } }, attributes: ['type', [fn('sum', col('amount')), 'total']], group: ['type'], raw: true }),
      AccountingTransaction.findAll({ where: reporting.where, include: this.includes(), order: [['source_event_at', 'DESC'], ['id', 'DESC']], limit: 8 })
    ]);
    const get = (rows, type) => amount(rows.find((row) => row.type === type)?.total);
    const totalIncome = get(totals, 'income');
    const totalExpenses = get(totals, 'expense');
    return {
      totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses,
      incomeThisMonth: get(monthTotals, 'income'),
      expensesThisMonth: get(monthTotals, 'expense'),
      recentTransactions, reportingEpoch: reporting.epoch, period: reporting.scope
    };
  }

  async reports(filters = {}, actor = null) {
    const transactions = await this.listTransactions(filters, actor);
    const rows = transactions.map((row) => row.toJSON());
    const totalIncome = rows.filter((row) => row.type === 'income').reduce((sum, row) => sum + amount(row.amount), 0);
    const totalExpenses = rows.filter((row) => row.type === 'expense').reduce((sum, row) => sum + amount(row.amount), 0);
    const groups = new Map();
    rows.forEach((row) => {
      const key = `${row.type}:${row.category?.id || row.categoryId}`;
      const current = groups.get(key) || { type: row.type, categoryId: row.category?.id || row.categoryId, category: row.category?.name || 'Unknown', total: 0, count: 0 };
      current.total += amount(row.amount);
      current.count += 1;
      groups.set(key, current);
    });
    return {
      totalIncome, totalExpenses, netProfit: totalIncome - totalExpenses,
      categoryBreakdown: [...groups.values()].sort((a, b) => b.total - a.total),
      transactions: rows, reportingEpoch: (await accountingEpochService.scopeWhere(filters.period || 'current', actor)).epoch, period: filters.period || 'current'
    };
  }
}

module.exports = new AccountingService();
