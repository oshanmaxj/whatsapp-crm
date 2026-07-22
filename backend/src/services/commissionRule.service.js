const { Op } = require('sequelize');
const { CommissionRule, CommissionTier, Course, Batch, User, Role, WhatsAppAccount, LeadSource, sequelize } = require('../models');

const can = (actor, permission) => actor?.isSystemAdmin || actor?.permissions?.includes(permission) ||
  (permission === 'commission.rule_manage' && actor?.permissions?.includes('commission.manage_rules'));
const fail = (message, status = 422, code = 'INVALID_COMMISSION_RULE') => Object.assign(new Error(message), { status, code });

class CommissionRuleService {
  normalize(payload = {}) {
    const calculationAliases={percentage:'percentage_collected',percentage_received:'percentage_collected',fixed:'fixed_per_payment',fixed_amount:'fixed_per_payment',per_student:'fixed_per_registration',per_registration:'fixed_per_registration',per_installment:'fixed_per_installment',net_revenue_percentage:'percentage_net_revenue'};
    const scopeAliases={all:'global',whatsapp:'account',whatsapp_account:'account',source:'lead_source'};
    const earningAliases={agent:'agent_commission',lecturer:'lecturer_commission',team_leader:'team_leader_commission',referrer:'referrer_commission',other:'other_commission'};
    const values={...payload};
    values.scopeType=scopeAliases[values.scopeType]||values.scopeType;
    values.calculationType=calculationAliases[values.calculationType||values.commissionType]||values.calculationType||values.commissionType;
    values.earningType=earningAliases[values.earningType||values.beneficiaryType]||values.earningType||'agent_commission';
    if(values.scopeType==='global')values.scopeId=null;
    return values;
  }

  validate(payload) {
    if (!String(payload.name || '').trim()) throw fail('Enter a rule name.');
    if (!payload.scopeType) throw fail('Choose where this rule applies.');
    if (!payload.earningType) throw fail('Choose who receives this commission.');
    if (!payload.calculationType) throw fail('Choose a commission method.');
    if (payload.scopeType !== 'global' && !payload.scopeId) throw fail('Select the item this rule applies to.');
    if (!payload.effectiveFrom) throw fail('Select a start date.');
    if (String(payload.calculationType).startsWith('percentage')) {
      const percentage=Number(payload.percentageRate);
      if(payload.percentageRate===''||!Number.isFinite(percentage)||percentage<0||percentage>100)throw fail('Commission percentage must be between 0 and 100.');
    } else {
      const amount=Number(payload.fixedAmount);
      if(payload.fixedAmount===''||!Number.isFinite(amount)||amount<0)throw fail('Fixed commission amount cannot be negative.');
    }
  }

  async options(type, query = {}) {
    const page=Math.max(1,Number(query.page)||1),limit=Math.min(50,Math.max(1,Number(query.limit)||20)),offset=(page-1)*limit;
    const search=String(query.q||query.search||'').trim();
    const like=search?{[Op.iLike]:`%${search}%`}:null;
    let result;
    if(type==='course')result=await Course.findAndCountAll({where:search?{[Op.or]:[{name:like},{code:like}]}:{},attributes:['id','name','code'],order:[['name','ASC']],limit,offset});
    else if(type==='batch')result=await Batch.findAndCountAll({where:{...(query.courseId?{courseId:query.courseId}:{}),...(search?{[Op.or]:[{name:like},{code:like}]}:{})},attributes:['id','name','code','courseId'],order:[['name','ASC']],limit,offset});
    else if(['agent','lecturer'].includes(type))result=await User.findAndCountAll({where:{status:'active',...(search?{[Op.or]:[{firstName:like},{lastName:like},{email:like},{phone:like}]}:{})},attributes:['id','firstName','lastName','email','phone'],include:[{model:Role,as:'roles',attributes:['id','name'],through:{attributes:[]},required:true,where:{name:{[Op.iLike]:type==='lecturer'?'%lecturer%':'%agent%'}}}],distinct:true,order:[['firstName','ASC']],limit,offset});
    else if(type==='account')result=await WhatsAppAccount.findAndCountAll({where:{status:'active',...(search?{[Op.or]:[{name:like},{phoneNumber:like},{phoneNumberId:like}]}:{})},attributes:['id','name','phoneNumber','phoneNumberId'],order:[['name','ASC']],limit,offset});
    else if(type==='lead_source')result=await LeadSource.findAndCountAll({where:search?{name:like}:{},attributes:['id','name'],order:[['name','ASC']],limit,offset});
    else if(['department','role'].includes(type))result=await Role.findAndCountAll({where:{isActive:true,...(search?{[Op.or]:[{name:like},{description:like}]}:{})},attributes:['id','name','description'],order:[['name','ASC']],limit,offset});
    else throw fail('Unsupported selector type.',400,'INVALID_SELECTOR');
    return {items:result.rows,page,limit,total:result.count,hasMore:offset+result.rows.length<result.count};
  }
  async list(filters = {}) {
    const rows=await CommissionRule.findAll({
      where: { ...(filters.status ? { status: filters.status } : {}), ...(filters.earningType ? { earningType: filters.earningType } : {}) },
      include: [{ model: CommissionTier, as: 'tiers', required: false }],
      order: [['priority', 'DESC'], ['id', 'DESC']]
    });
    return Promise.all(rows.map(async row=>{
      const json=row.toJSON();const id=json.scopeId||json.courseId||json.agentUserId||json.departmentId;if(!id||json.scopeType==='global')return json;
      const models={course:Course,batch:Batch,agent:User,lecturer:User,account:WhatsAppAccount,lead_source:LeadSource};const model=models[json.scopeType];
      if(!model)return json;const scopeEntity=await model.findByPk(id,{attributes:json.scopeType==='account'?['id','name','phoneNumber','phoneNumberId']:['id',...(model===User?['firstName','lastName','email','phone']:['name'])]}).catch(()=>null);return{...json,scopeEntity};
    }));
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
    payload=this.normalize(payload);
    this.validate(payload);
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
