const logger = require('../config/logger');

module.exports = (err, req, res, next) => {
  const status = err.status || 500;
  const requestId = req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const response = {
    success: false,
    message: status >= 500 && !err.exposeMessage ? 'Internal server error' : (err.message || 'Request failed'),
    requestId
  };

  if (err.details) {
    response.details = err.details;
  }
  if ([
    'AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED', 'AUTH_REFRESH_REQUIRED', 'AUTH_REFRESH_INVALID', 'USER_DISABLED',
    'STUDENT_NOT_FOUND', 'INVALID_PHONE', 'OTP_RATE_LIMITED', 'OTP_SEND_FAILED',
    'OTP_INVALID', 'OTP_EXPIRED', 'WHATSAPP_CONFIGURATION_MISSING', 'WHATSAPP_AUTHENTICATION_FAILED',
    'WHATSAPP_TEMPORARY_FAILURE', 'WHATSAPP_META_REJECTED', 'WHATSAPP_CONFIGURATION_INVALID',
    'WHATSAPP_CONNECTION_INVALID', 'WHATSAPP_PHONE_NUMBER_INACCESSIBLE', 'WHATSAPP_CONNECTION_FAILED',
    'WHATSAPP_ACCOUNT_INACTIVE', 'INVALID_TEMPLATE_NAME', 'INVALID_TEMPLATE_LANGUAGE', 'CONVERSATION_ALREADY_ASSIGNED',
    'CONVERSATION_OWNED_BY_ANOTHER_AGENT', 'REASSIGN_PERMISSION_REQUIRED',
    'REASSIGN_REASON_REQUIRED', 'PAYMENT_CREDIT_OVERRIDE_FORBIDDEN',
    'STUDENT_CONVERSION_FORBIDDEN', 'STALE_ASSIGNMENT_UPDATE', 'COMMISSION_RULE_NOT_FOUND',
    'COMMISSION_ALREADY_EXISTS', 'COMMISSION_NOT_ELIGIBLE', 'COMMISSION_OVERRIDE_FORBIDDEN',
    'COMMISSION_REASON_REQUIRED', 'COMMISSION_ALREADY_PAID', 'PAYOUT_ALREADY_PROCESSED',
    'INVALID_COMMISSION_RULE', 'PAYMENT_NOT_CONFIRMED', 'PIPELINE_PERMISSION_REQUIRED',
    'INVALID_PIPELINE_STAGE','DUPLICATE_PIPELINE_STAGE','LEAD_ACCESS_FORBIDDEN','LEAD_OWNED_BY_ANOTHER_AGENT',
    'LEAD_REASSIGN_FORBIDDEN','STALE_LEAD_UPDATE','LOST_REASON_REQUIRED','FOLLOWUP_PERMISSION_REQUIRED',
    'FOLLOWUP_OUTCOME_REQUIRED','FOLLOWUP_IMMUTABLE','FOLLOWUP_DUE_REQUIRED',
    'LEAD_NOT_FOUND','INVALID_LEAD_STATUS','LEAD_STATUS_NOT_INITIALIZED','LEAD_STATUS_UPDATE_FORBIDDEN','STALE_LEAD_STATUS_UPDATE',
    'LEAD_STATUS_ACTIVITY_FAILED','LEAD_STATUS_AUDIT_FAILED','INVALID_DATE_RANGE','UNIFIED_LEAD_STATUS_CONFLICT'
  ].includes(err.code)) {
    response.code = err.code;
  }

  logger[status >= 500 ? 'error' : 'warn']('request_failed', {
    requestId,
    status,
    method: req.method,
    path: req.originalUrl,
    userId: req.user?.id || null,
    error: err
  });

  if (process.env.NODE_ENV === 'development') {
    response.stack = err.stack;
    response.message = err.message || response.message;
  }

  if (err.exposeResponseData && err.response?.data) {
    return res.status(err.response.status || status).json(err.response.data);
  }

  res.status(status).json(response);
};
