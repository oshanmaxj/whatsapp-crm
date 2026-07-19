export const FLOW_VARIABLES = [
  '{{LEAD_USER_FIRST_NAME}}',
  '{{contact.name}}',
  '{{lead.course}}',
  '{{agent.name}}',
  '{{department.name}}'
];

const blank = (value) => !String(value ?? '').trim();

export function buttonActionFields(actionType) {
  const type = String(actionType || 'CONTINUE_FLOW').toUpperCase();
  if (type === 'SEND_MESSAGE') return ['message'];
  if (type === 'START_FLOW') return ['targetFlowId', 'stopCurrentFlow', 'pauseCurrentFlow'];
  if (type === 'OPEN_URL' || type === 'URL') return ['url'];
  if (type === 'CALL_PHONE' || type === 'PHONE') return ['phone'];
  return [];
}

export function compatibleButton(button = {}) {
  const legacy = String(button.actionType || '').toLowerCase();
  const primaryActionType = button.primaryActionType || (legacy === 'url' ? 'OPEN_URL' : legacy === 'phone' ? 'CALL_PHONE' : 'CONTINUE_FLOW');
  const primaryActionConfig = button.primaryActionConfig || (legacy === 'url' ? { url: button.url || '' } : legacy === 'phone' ? { phone: button.phone || '' } : {});
  return { ...button, primaryActionType, primaryActionConfig, automationActions: button.automationActions || [] };
}

export function normalizeKeywords(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item).split(','))
      .map((item) => item.normalize('NFC').trim().replace(/\s+/gu, ' '))
      .filter(Boolean)
      .filter((item, index, rows) => rows.indexOf(item) === index);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.normalize('NFC').trim().replace(/\s+/gu, ' '))
    .filter(Boolean)
    .filter((item, index, rows) => rows.indexOf(item) === index);
}

function isPublicHttpsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(url.hostname) && !url.hostname.endsWith('.local');
  } catch {
    return false;
  }
}

export function nodeConfigErrors(nodeType, config = {}) {
  const errors = {};
  const require = (field, message) => {
    if (blank(config[field])) errors[field] = message;
  };

  if (nodeType === 'start') {
    require('source', 'Choose what starts this flow.');
    if (config.source === 'inbound_message' && !normalizeKeywords(config.keywords).length) {
      errors.keywords = 'Add at least one trigger keyword.';
    }
  }
  if (['text_message', 'interactive_message', 'button_message', 'list_message'].includes(nodeType)) {
    require('message', 'Enter a message body.');
  }
  if (nodeType === 'interactive_message' && config.headerType === 'text') {
    require('headerText', 'Enter header text.');
  }
  if (nodeType === 'interactive_message' && config.headerType === 'media') {
    require('headerMediaUrl', 'Select media or enter a media URL.');
  }
  if (['interactive_message', 'button_message'].includes(nodeType)) {
    const buttons = Array.isArray(config.buttons) ? config.buttons : [];
    if (!buttons.length) errors.buttons = 'Add at least one button.';
    if (buttons.length > 3) errors.buttons = 'WhatsApp supports at most 3 reply buttons.';
    buttons.forEach((button, index) => {
      if (blank(button.title)) errors[`button_${index}_title`] = 'Button label is required.';
      if (String(button.title || '').length > 20) errors[`button_${index}_title`] = 'Button labels may contain at most 20 characters.';
      const actionType = String(button.primaryActionType || button.actionType || 'CONTINUE_FLOW').toUpperCase();
      if (['OPEN_URL', 'URL'].includes(actionType) && !isPublicHttpsUrl(button.primaryActionConfig?.url || button.url)) errors[`button_${index}_value`] = 'Enter a public HTTPS URL.';
      if (['CALL_PHONE', 'PHONE'].includes(actionType) && blank(button.primaryActionConfig?.phone || button.phone)) errors[`button_${index}_value`] = 'Enter a phone number.';
      if (actionType === 'SEND_MESSAGE' && blank(button.primaryActionConfig?.message || button.message)) errors[`button_${index}_value`] = 'Enter the message to send.';
      if (actionType === 'START_FLOW' && blank(button.primaryActionConfig?.targetFlowId || button.targetFlowId)) errors[`button_${index}_value`] = 'Select a published flow.';
      if (blank(button.id || button.payload)) {
        errors[`button_${index}_value`] = 'Button payload is required.';
      }
    });
  }
  if (nodeType === 'list_message') {
    if (!(config.rows || []).length) errors.rows = 'Add at least one list option.';
    if ((config.rows || []).length > 10) errors.rows = 'A WhatsApp list section supports at most 10 rows.';
    (config.rows || []).forEach((row, index) => { if (String(row.title || '').length > 24) errors[`button_${index}_title`] = 'List row titles may contain at most 24 characters.'; });
  }
  if (nodeType === 'image_message') {
    const sourceType = config.sourceType || (config.whatsappMediaId ? 'media_id' : 'url');
    if (sourceType === 'media_id' && blank(config.whatsappMediaId)) errors.whatsappMediaId = 'Enter a WhatsApp media ID.';
    if (sourceType === 'upload' && blank(config.whatsappMediaId) && blank(config.fileDataBase64)) errors.file = 'Upload an image before saving.';
    if (sourceType === 'url') {
      const imageUrl = config.imageUrl || config.mediaUrl;
      if (blank(imageUrl)) errors.imageUrl = 'Enter a public HTTPS image URL.';
      else if (!isPublicHttpsUrl(imageUrl)) errors.imageUrl = 'Use a public HTTPS image URL. Localhost and HTTP URLs are not allowed.';
    }
  }
  if (nodeType === 'video_message') require('mediaUrl', 'Select a video or enter its URL.');
  if (nodeType === 'audio_message') require('mediaUrl', 'Select audio or enter its URL.');
  if (nodeType === 'file_document') {
    require('fileUrl', 'Select a file or enter its URL.');
    require('fileName', 'Enter the filename shown to the recipient.');
  }
  if (nodeType === 'ai_reply') {
    require('prompt', 'Tell AI how it should reply.');
    require('fallbackMessage', 'Add a fallback response.');
  }
  if (nodeType === 'assign' && blank(config.departmentId) && blank(config.assignedAgentId)) {
    errors.assignment = 'Choose a department or a user.';
  }
  if (nodeType === 'delay_wait') {
    if (!Number(config.amount) || Number(config.amount) < 1) errors.amount = 'Wait time must be at least 1.';
    require('unit', 'Choose a time unit.');
  }
  if (nodeType === 'user_input') {
    require('question', 'Enter the question to ask.');
    require('saveAs', 'Choose where the answer will be saved.');
    if (!Number(config.timeoutMinutes) || Number(config.timeoutMinutes) < 1) errors.timeoutMinutes = 'Timeout must be at least 1 minute.';
  }
  return errors;
}

export function isNodeConfigComplete(nodeType, config) {
  return Object.keys(nodeConfigErrors(nodeType, config)).length === 0;
}
