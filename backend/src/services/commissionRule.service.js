const { Op } = require('sequelize');
const { CommissionRule, CommissionTier, sequelize } = require('../models');

const can = (actor, permission) => actor?.isSystemAdmin || actor?.permissions?.includes(permission) ||
  (permission === 'commission.rule_manage' && actor?.permissions?.includes('commission.manage_rules'));
const fail = (message, status = 422, code = 'INVALID_COMMISSION_RULE') => Object.assign(new Error(message), { status, code });

class CommissionRuleService {
  async list(filters = {}) {
    return CommissionRule.findAll({
      where: { ...(filters.status ? { status: filters.status } : {}), ...(filters.earningType ? { earningType: filters.earningType } : {}) },
      include: [{ model: CommissionTier, as: 'tiers', required: false }],
      order: [['priority', 'DESC'], ['id', 'DESC']]
    });
  }

  matches(rule, context) {
    const ids = {
      global: null, account: context.whatsappAccountId, course: context.courseId, batch: context.batchId,
      lead_source: context.leadSourceId, campaign: context.campaignId, agent: context.agentUserId,
      lecturer: context.lecturerUserId, department: context.departmentId, payment_method: context.paymentMethod
    };
    if (!(rule.scopeType in ids)) return { matched: false, reason: 'Unsupported rule scope' };
    const legacyScopeId={agent:rule.agentUserId,course:rule.courseId,department:rule.departmentId}[rule.scopeType];
    if (rule.scopeType !== 'global' && String(rule.scopeId || legacyScopeId || '') !== String(ids[rule.scopeType] || '')) {
      return { matched: false, reason: `Payment does not match ${rule.scopeType} scope` };
    }
    if (rule.minimumPaymentAmount && require('../utils/decimal').compare(context.collectedAmount, rule.minimumPaymentAmount) < 0) return { matched: false, reason: 'Below minimum payment' };
    return { matched: true };
  }

  async resolve(context, { transaction } = {}) {
    const date = context.confirmedDate || new Date();
    const rules = await CommissionRule.findAll({
      where: { status: 'active', active: true, effectiveFrom: { [Op.lte]: date }, [Op.or]: [{ effectiveTo: null }, { effectiveTo: { [Op.gte]: date } }] },
      include: [{ model: CommissionTier, as: 'tiers', required: false }], order: [['priority', 'DESC'], ['id', 'ASC']], transaction
    });
    const evaluated = rules.map(rule => ({ rule, ...this.matches(rule, context) }));
    const selected = [];
    for (const item of evaluated.filter(item => item.matched)) {
      const sameType = selected.filter(chosen => chosen.rule.earningType === item.rule.earningType);
      if (sameType.length && (sameType.some(chosen => chosen.rule.exclusive || !chosen.rule.stackable) || item.rule.exclusive || !item.rule.stackable)) {
        item.matched = false;
        item.reason = 'Excluded by a higher-priority exclusive/non-stackable rule';
        continue;
      }
      selected.push(item);
    }
    return { selected: selected.map(item => item.rule), evaluated };
  }

  async save(id, payload, actor) {
    if (!can(actor, 'commission.rule_manage')) throw fail('Rule management permission required.', 403, 'FORBIDDEN');
    if (!payload.name || !payload.scopeType || !payload.earningType || !payload.calculationType) throw fail('Name, scope, earning type, and calculation type are required.');
    return sequelize.transaction(async transaction => {
      const nullable=['scopeId','beneficiaryId','agentUserId','departmentId','courseId','percentageRate','fixedAmount','minimumPaymentAmount','maximumCommissionAmount','effectiveTo'];
      const values = { ...payload, commissionType: payload.commissionType || payload.calculationType, updatedByUserId: actor.id };
      nullable.forEach(field=>{if(values[field]==='')values[field]=null;});
      if (values.status === 'active' && values.exclusive !== false) {
        const conflict = await CommissionRule.findOne({ where: { id: { [Op.ne]: id || 0 }, status: 'active', exclusive: true,
          earningType: values.earningType, scopeType: values.scopeType, scopeId: values.scopeId || null }, transaction, lock: transaction.LOCK.UPDATE });
        if (conflict) throw fail(`Conflicts with active exclusive rule “${conflict.name}”.`, 409, 'CONFLICTING_EXCLUSIVE_RULE');
      }
      const row = id ? await CommissionRule.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }) : null;
      if (id && !row) throw fail('Rule not found.', 404, 'NOT_FOUND');
      const saved = row ? await row.update(values, { transaction }) : await CommissionRule.create({ ...values, createdByUserId: actor.id }, { transaction });
      if (Array.isArray(payload.tiers)) {
        await CommissionTier.destroy({ where: { commissionRuleId: saved.id }, transaction });
        await CommissionTier.bulkCreate(payload.tiers.map(tier => ({ ...tier, commissionRuleId: saved.id })), { transaction });
      }
      return saved;
    });
  }
}

module.exports = new CommissionRuleService();
