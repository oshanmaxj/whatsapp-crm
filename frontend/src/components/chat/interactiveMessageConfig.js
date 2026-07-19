export const INTERACTIVE_MEDIA_RULES = {
  image: { maxBytes: 5 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png'], accept: 'image/jpeg,image/png' },
  video: { maxBytes: 16 * 1024 * 1024, mimeTypes: ['video/mp4', 'video/3gpp'], accept: 'video/mp4,video/3gpp' },
  document: {
    maxBytes: 100 * 1024 * 1024,
    mimeTypes: ['application/pdf', 'text/plain', 'text/csv', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    accept: '.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx'
  }
};

export function validateInteractiveDraft(draft = {}) {
  const errors = {};
  if (!String(draft.body || '').trim()) errors.body = 'Message body is required.';
  const buttons = Array.isArray(draft.buttons) ? draft.buttons : [];
  if (buttons.length < 1 || buttons.length > 3) errors.buttons = 'Add 1 to 3 reply buttons.';
  if (buttons.some((button) => !String(button.title || '').trim())) errors.buttons = 'Every button needs a title.';
  if (buttons.some((button) => String(button.title || '').length > 20)) errors.buttons = 'Button titles may contain at most 20 characters.';
  if (draft.headerType === 'text' && (!String(draft.headerText || '').trim() || String(draft.headerText).length > 60)) errors.header = 'Text header must contain 1 to 60 characters.';
  if (['image', 'video', 'document'].includes(draft.headerType)) {
    const file = draft.file;
    const rule = INTERACTIVE_MEDIA_RULES[draft.headerType];
    if (!file) errors.header = 'Select a media file.';
    else if (!rule.mimeTypes.includes(file.type)) errors.header = `Unsupported ${draft.headerType} type.`;
    else if (!file.size) errors.header = 'The selected file is empty.';
    else if (file.size > rule.maxBytes) errors.header = `File exceeds the WhatsApp ${rule.maxBytes / 1024 / 1024} MB limit.`;
  }
  return errors;
}
