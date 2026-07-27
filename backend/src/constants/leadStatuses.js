const LEAD_STATUSES = Object.freeze([
  { code: 'new', name: 'New', color: '#2196f3' },
  { code: 'assigned', name: 'Assigned', color: '#5c6bc0' },
  { code: 'call_pending', name: 'Call Pending', color: '#78909c' },
  { code: 'calling', name: 'Calling', color: '#7e57c2' },
  { code: 'contacted', name: 'Contacted', color: '#607d8b' },
  { code: 'no_answer', name: 'No Answer', color: '#ef6c00' },
  { code: 'busy', name: 'Busy', color: '#f9a825' },
  { code: 'switched_off', name: 'Switched Off', color: '#757575' },
  { code: 'call_rejected', name: 'Call Rejected', color: '#8d6e63' },
  { code: 'wrong_number', name: 'Wrong Number', color: '#d32f2f' },
  { code: 'interested', name: 'Interested', color: '#00a884' },
  { code: 'follow_up_required', name: 'Follow-up Required', color: '#0288d1' },
  { code: 'not_interested', name: 'Not Interested', color: '#c62828' },
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
    followup_required: 'follow_up_required', payment_pending: 'agreed', converted: 'registered',
    converted_to_student: 'registered'
  };
  return aliases[normalized] || normalized;
}

module.exports = { LEAD_STATUSES, LEAD_STATUS_CODES, LEAD_STATUS_BY_CODE, normalizeLeadStatusCode };
