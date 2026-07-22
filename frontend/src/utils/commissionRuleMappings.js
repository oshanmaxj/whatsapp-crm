export const COMMISSION_FOR_OPTIONS = [
  ['agent_commission', 'Sales Agent'], ['lecturer_commission', 'Lecturer'],
  ['team_leader_commission', 'Team Leader'], ['referrer_commission', 'Referrer'], ['other_commission', 'Other']
];

export const SCOPE_OPTIONS = [
  ['global', 'All Payments'], ['course', 'A Specific Course'], ['batch', 'A Specific Batch'],
  ['agent', 'A Specific Agent'], ['lecturer', 'A Specific Lecturer'],
  ['account', 'A Specific WhatsApp Number'], ['lead_source', 'A Specific Lead Source']
];

export const CALCULATION_OPTIONS = [
  ['percentage_collected', 'Percentage of Received Payment'],
  ['fixed_per_payment', 'Fixed Amount per Payment'],
  ['fixed_per_registration', 'Fixed Amount per Student Registration'],
  ['fixed_per_installment', 'Fixed Amount per Installment'],
  ['percentage_after_discount', 'Percentage after Discount'],
  ['percentage_net_revenue', 'Percentage of Net Revenue']
];

const legacyCalculation = {
  percentage: 'percentage_collected', percentage_received: 'percentage_collected',
  fixed: 'fixed_per_payment', fixed_amount: 'fixed_per_payment',
  per_student: 'fixed_per_registration', per_registration: 'fixed_per_registration',
  per_installment: 'fixed_per_installment', net_revenue_percentage: 'percentage_net_revenue'
};
const legacyScope = { all: 'global', whatsapp: 'account', whatsapp_account: 'account', source: 'lead_source' };
const legacyEarning = { agent: 'agent_commission', lecturer: 'lecturer_commission', team_leader: 'team_leader_commission', referrer: 'referrer_commission', other: 'other_commission' };

export function normalizeCommissionRule(rule = {}) {
  const scopeType = legacyScope[rule.scopeType] || rule.scopeType || 'global';
  return {
    ...rule,
    earningType: legacyEarning[rule.earningType || rule.beneficiaryType] || rule.earningType || 'agent_commission',
    scopeType,
    scopeId: scopeType === 'global' ? '' : (rule.scopeId || rule.courseId || rule.agentUserId || rule.departmentId || ''),
    calculationType: legacyCalculation[rule.calculationType || rule.commissionType] || rule.calculationType || rule.commissionType || 'percentage_collected',
    status: rule.status || (rule.active === false ? 'paused' : 'active'),
    approvalRequired: rule.approvalRequired !== false
  };
}

export const isPercentageMethod = (value) => String(value || '').startsWith('percentage');
export const optionLabel = (options, value) => options.find(([key]) => key === value)?.[1] || String(value || '').replaceAll('_', ' ');

export function validateCommissionRule(form) {
  const errors = {};
  if (!String(form.name || '').trim()) errors.name = 'Enter a rule name.';
  if (!form.earningType) errors.earningType = 'Choose who receives this commission.';
  if (!form.scopeType) errors.scopeType = 'Choose where this rule applies.';
  if (form.scopeType !== 'global' && !form.scopeId) errors.scopeId = 'Select the item this rule applies to.';
  if (!form.calculationType) errors.calculationType = 'Choose a commission method.';
  if (isPercentageMethod(form.calculationType)) {
    const value = Number(form.percentageRate);
    if (form.percentageRate === '' || !Number.isFinite(value) || value < 0 || value > 100) errors.percentageRate = 'Commission percentage must be between 0 and 100.';
  } else {
    const value = Number(form.fixedAmount);
    if (form.fixedAmount === '' || !Number.isFinite(value) || value < 0) errors.fixedAmount = 'Fixed commission amount cannot be negative.';
  }
  if (!form.effectiveFrom) errors.effectiveFrom = 'Select a start date.';
  return errors;
}

export function commissionRulePayload(form) {
  const normalized = normalizeCommissionRule(form);
  return {
    ...normalized,
    scopeId: normalized.scopeType === 'global' ? null : normalized.scopeId,
    percentageRate: isPercentageMethod(normalized.calculationType) ? normalized.percentageRate : null,
    fixedAmount: isPercentageMethod(normalized.calculationType) ? null : normalized.fixedAmount,
    commissionType: normalized.calculationType,
    beneficiaryType: normalized.earningType.replace('_commission', ''),
    active: normalized.status === 'active'
  };
}
