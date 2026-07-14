const LEAD_STATUSES = Object.freeze([
  { code: 'new', name: 'New', color: '#2196f3' },
  { code: 'contacted', name: 'Contacted', color: '#607d8b' },
  { code: 'interested', name: 'Interested', color: '#00a884' },
  { code: 'ignore', name: 'Ignore', color: '#9e9e9e' },
  { code: 'agreed', name: 'Agreed', color: '#f57c00' },
  { code: 'registered', name: 'Registered', color: '#43a047' },
  { code: 'lost', name: 'Lost', color: '#d32f2f' }
]);

const LEAD_STATUS_CODES = Object.freeze(LEAD_STATUSES.map((status) => status.code));
const LEAD_STATUS_BY_CODE = Object.freeze(Object.fromEntries(LEAD_STATUSES.map((status) => [status.code, status])));

function normalizeLeadStatusCode(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const aliases = {
    new_lead: 'new', seminar_invited: 'interested', seminar_joined: 'interested',
    followup_required: 'contacted', payment_pending: 'agreed', converted: 'registered',
    converted_to_student: 'registered', not_interested: 'ignore'
  };
  return aliases[normalized] || normalized;
}

module.exports = { LEAD_STATUSES, LEAD_STATUS_CODES, LEAD_STATUS_BY_CODE, normalizeLeadStatusCode };
