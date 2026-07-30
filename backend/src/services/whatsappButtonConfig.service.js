const { normalizeText } = require('./flowTriggerMatcher.service');

const BEHAVIORS = new Set(['trigger_keyword', 'start_flow', 'crm_action', 'none']);
const SEQUENCE_BEHAVIORS = new Set(['continue', 'pause', 'stop', 'complete', 'flow_decides']);

function normalizeButton(button = {}, index = 0) {
  return {
    title: String(button.title || '').trim(),
    buttonId: String(button.buttonId || button.id || '').trim(),
    behavior: BEHAVIORS.has(button.behavior) ? button.behavior : 'none',
    triggerKeyword: button.behavior === 'trigger_keyword'
      ? normalizeText(button.triggerKeyword, { caseInsensitive: false }) : null,
    flowId: button.flowId || null,
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
  });
  return { buttons, errors };
}

function metaReplyButtons(value) {
  return normalizeButtons(value).map(button => ({ id: button.buttonId, title: button.title }));
}

module.exports = { normalizeButton, normalizeButtons, validateButtons, metaReplyButtons, BEHAVIORS, SEQUENCE_BEHAVIORS };
