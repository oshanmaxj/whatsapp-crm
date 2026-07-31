const { normalizeText } = require('./flowTriggerMatcher.service');

const BEHAVIORS = new Set(['trigger_keyword', 'start_flow', 'crm_action', 'none']);
const SEQUENCE_BEHAVIORS = new Set(['continue', 'pause', 'stop', 'complete', 'flow_decides']);

const CANONICAL_ACTIONS = new Set(['SEND_MESSAGE', 'START_FLOW', 'CONTINUE_FLOW', 'OPEN_URL', 'CALL_PHONE', 'SYSTEM_DEFAULT_ACTION']);

function legacyAction(button) {
  if (button.behavior === 'start_flow') return 'START_FLOW';
  if (button.behavior === 'trigger_keyword') return 'SYSTEM_DEFAULT_ACTION';
  if (button.behavior === 'crm_action') return 'SYSTEM_DEFAULT_ACTION';
  return 'CONTINUE_FLOW';
}

function normalizeButton(button = {}, index = 0) {
  const requestedAction = String(button.primaryActionType || legacyAction(button)).toUpperCase();
  const primaryActionType = CANONICAL_ACTIONS.has(requestedAction) ? requestedAction : 'CONTINUE_FLOW';
  const primaryActionConfig = button.primaryActionConfig || {};
  const generatedId = `reminder_${Date.now().toString(36)}_${index}_${Math.random().toString(36).slice(2, 10)}`;
  return {
    title: String(button.title || '').trim(),
    buttonId: String(button.buttonId || button.payload || button.id || generatedId).trim(),
    id: String(button.id || button.buttonId || button.payload || generatedId).trim(),
    payload: String(button.payload || button.buttonId || button.id || generatedId).trim(),
    primaryActionType,
    primaryActionConfig,
    automationActions: Array.isArray(button.automationActions) ? button.automationActions : [],
    behavior: BEHAVIORS.has(button.behavior) ? button.behavior : 'none',
    triggerKeyword: button.behavior === 'trigger_keyword'
      ? normalizeText(button.triggerKeyword, { caseInsensitive: false }) : null,
    flowId: primaryActionConfig.targetFlowId || button.flowId || null,
    crmAction: button.crmAction || null,
    fallbackResponse: String(button.fallbackResponse || '').trim() || null,
    sequenceBehavior: SEQUENCE_BEHAVIORS.has(button.sequenceBehavior) ? button.sequenceBehavior : 'flow_decides',
    order: index
  };
}

function normalizeButtons(value) {
  const source = Array.isArray(value) ? value : Array.isArray(value?.buttons) ? value.buttons : [];
  return source.map(normalizeButton);
}

function validateButtons(value, prefix = 'buttons') {
  const buttons = normalizeButtons(value);
  const errors = {};
  if (buttons.length > 3) errors[prefix] = 'WhatsApp reply messages support at most 3 buttons.';
  const ids = new Set(), titles = new Set();
  buttons.forEach((button, index) => {
    const field = `${prefix}.${index}`;
    if (!button.title || button.title.length > 20) errors[`${field}.title`] = 'Button title must contain 1 to 20 characters.';
    if (!button.buttonId || button.buttonId.length > 256 || /\s/.test(button.buttonId)) errors[`${field}.buttonId`] = 'Stable button ID must contain 1 to 256 characters without spaces.';
    if (ids.has(button.buttonId)) errors[`${field}.buttonId`] = 'Button IDs must be unique.';
    if (titles.has(button.title)) errors[`${field}.title`] = 'Button titles must be unique.';
    ids.add(button.buttonId); titles.add(button.title);
    if (button.behavior === 'trigger_keyword' && !button.triggerKeyword) errors[`${field}.triggerKeyword`] = 'Trigger keyword is required.';
    if (button.behavior === 'start_flow' && !button.flowId) errors[`${field}.flowId`] = 'Select a flow.';
    if (button.primaryActionType === 'START_FLOW' && !button.primaryActionConfig?.targetFlowId) errors[`${field}.primaryActionConfig.targetFlowId`] = 'Select a published flow.';
    if (button.primaryActionType === 'SEND_MESSAGE' && !String(button.primaryActionConfig?.message || '').trim()) errors[`${field}.primaryActionConfig.message`] = 'Enter the message to send.';
    if (button.primaryActionType === 'OPEN_URL' && !/^https?:\/\/[^\s]+$/i.test(String(button.primaryActionConfig?.url || ''))) errors[`${field}.primaryActionConfig.url`] = 'Enter a valid HTTP or HTTPS URL.';
    if (button.primaryActionType === 'CALL_PHONE' && !/^\+[1-9]\d{6,14}$/.test(String(button.primaryActionConfig?.phone || ''))) errors[`${field}.primaryActionConfig.phone`] = 'Enter an international phone number such as +94771234567.';
  });
  return { buttons, errors };
}

function metaReplyButtons(value) {
  return normalizeButtons(value).map(button => ({ id: button.buttonId, title: button.title }));
}

module.exports = { normalizeButton, normalizeButtons, validateButtons, metaReplyButtons, BEHAVIORS, SEQUENCE_BEHAVIORS, CANONICAL_ACTIONS };
