const REMINDER_SEQUENCE_STATUS = Object.freeze({
  DRAFT: 'draft',
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived'
});

const REMINDER_SEQUENCE_STATUSES = new Set(Object.values(REMINDER_SEQUENCE_STATUS));
const REMINDER_SEQUENCE_TRANSITIONS = Object.freeze({
  draft: new Set(['active', 'archived']),
  active: new Set(['paused', 'archived']),
  paused: new Set(['active', 'archived']),
  archived: new Set([])
});

module.exports = { REMINDER_SEQUENCE_STATUS, REMINDER_SEQUENCE_STATUSES, REMINDER_SEQUENCE_TRANSITIONS };
