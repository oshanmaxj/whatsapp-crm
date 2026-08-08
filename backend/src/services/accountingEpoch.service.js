const { Op } = require('sequelize');
const { AccountingReportingEpoch, AccountingTransaction, sequelize } = require('../models');
const auditService = require('./audit.service');

const RESET_LOCK = 570059;
const DEFAULT_REASON = 'Accounting ledger reset requested by administrator';

function requireAdmin(actor) {
  if (!actor?.isSystemAdmin) throw Object.assign(new Error('System administrator access is required.'), { status: 403, code: 'ACCOUNTING_RESET_FORBIDDEN' });
}

class AccountingEpochService {
  async current(options = {}) {
    return AccountingReportingEpoch.findOne({
      include: [{ association: 'changedBy', attributes: ['id', 'firstName', 'lastName', 'email'], required: false }],
      order: [['changedAt', 'DESC'], ['id', 'DESC']], transaction: options.transaction
    });
  }

  async scopeWhere(scope = 'current', actor = null, options = {}) {
    const normalized = ['current', 'historical', 'all'].includes(scope) ? scope : 'current';
    if (normalized !== 'current') requireAdmin(actor);
    const epoch = await this.current(options);
    if (!epoch || normalized === 'all') return { where: {}, epoch, scope: normalized };
    return {
      where: { sourceEventAt: normalized === 'historical' ? { [Op.lt]: epoch.trackingStartedAt } : { [Op.gte]: epoch.trackingStartedAt } },
      epoch, scope: normalized
    };
  }

  async preview({ trackingStartedAt }, actor) {
    requireAdmin(actor);
    const proposed = new Date(trackingStartedAt);
    if (Number.isNaN(proposed.getTime()) || proposed.getTime() > Date.now()) throw Object.assign(new Error('Tracking start must be a valid timestamp that is not in the future.'), { status: 422, code: 'ACCOUNTING_EPOCH_INVALID' });
    const [currentEpoch, rows, affectedHistoricalTransactions] = await Promise.all([
      this.current(),
      AccountingTransaction.findAll({ attributes: ['type', [sequelize.fn('count', sequelize.col('id')), 'count'], [sequelize.fn('sum', sequelize.col('amount')), 'total']], group: ['type'], raw: true }),
      AccountingTransaction.count({ where: { sourceEventAt: { [Op.lt]: proposed } } })
    ]);
    const value = type => rows.find(row => row.type === type) || { count: 0, total: 0 };
    return { proposedTrackingStartedAt: proposed, currentEpoch, affectedHistoricalTransactions,
      existingTotals: { incomeCount: Number(value('income').count), totalIncome: Number(value('income').total || 0), expenseCount: Number(value('expense').count), totalExpenses: Number(value('expense').total || 0) } };
  }

  async reset(payload, actor, request = {}) {
    requireAdmin(actor);
    if (payload.confirmation !== 'RESET ACCOUNTING') throw Object.assign(new Error('Type RESET ACCOUNTING to confirm.'), { status: 422, code: 'ACCOUNTING_RESET_CONFIRMATION_REQUIRED' });
    const trackingStartedAt = new Date(payload.trackingStartedAt || payload.tracking_started_at);
    if (Number.isNaN(trackingStartedAt.getTime()) || trackingStartedAt.getTime() > Date.now()) throw Object.assign(new Error('Tracking start must be a valid timestamp that is not in the future.'), { status: 422, code: 'ACCOUNTING_EPOCH_INVALID' });
    const reason = String(payload.reason || DEFAULT_REASON).trim();
    if (!reason) throw Object.assign(new Error('Reset reason is required.'), { status: 422, code: 'ACCOUNTING_RESET_REASON_REQUIRED' });
    let epoch;
    await sequelize.transaction(async transaction => {
      await sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: RESET_LOCK }, transaction });
      const previous = await AccountingReportingEpoch.findOne({ order: [['changedAt', 'DESC'], ['id', 'DESC']], transaction, lock: transaction.LOCK.UPDATE });
      epoch = await AccountingReportingEpoch.create({ trackingStartedAt, changedByUserId: actor.id, changedAt: new Date(), reason, previousTrackingStartedAt: previous?.trackingStartedAt || null, timezone: payload.timezone || 'Asia/Colombo' }, { transaction });
      await auditService.record({ userId: actor.id, action: 'ACCOUNTING_REPORTING_EPOCH_RESET', entityType: 'accounting_reporting_epoch', entityId: epoch.id,
        method: request.method, path: request.path, ipAddress: request.ipAddress, userAgent: request.userAgent,
        changes: { trackingStartedAt, previousTrackingStartedAt: previous?.trackingStartedAt || null, reason, timezone: epoch.timezone }, transaction, required: true });
    });
    return epoch;
  }
}

module.exports = new AccountingEpochService();
module.exports.requireAdmin = requireAdmin;
