export const FLOW_VARIABLES = [
  '{{LEAD_USER_FIRST_NAME}}',
  '{{contact.name}}',
  '{{lead.course}}',
  '{{agent.name}}',
  '{{department.name}}'
];

const blank = (value) => !String(value ?? '').trim();

export function normalizeKeywords(value) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => String(item).split(','))
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .filter((item, index, rows) => rows.indexOf(item) === index);
  }
  return String(value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
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
    buttons.forEach((button, index) => {
      if (blank(button.title)) errors[`button_${index}_title`] = 'Button label is required.';
      if (button.actionType === 'url' && blank(button.url)) errors[`button_${index}_value`] = 'Enter a valid URL.';
      if (button.actionType === 'phone' && blank(button.phone)) errors[`button_${index}_value`] = 'Enter a phone number.';
      if ((!button.actionType || button.actionType === 'reply') && blank(button.id || button.payload)) {
        errors[`button_${index}_value`] = 'Button payload is required.';
      }
    });
  }
  if (nodeType === 'list_message') {
    if (!(config.rows || []).length) errors.rows = 'Add at least one list option.';
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
