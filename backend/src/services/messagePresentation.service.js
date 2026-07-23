function replyFromRaw(raw = {}) {
  if (raw.interactiveReply) return raw.interactiveReply;
  const type = raw.interactive?.type || (raw.button ? 'button_reply' : null);
  const reply = type === 'button_reply' ? raw.interactive?.button_reply
    : type === 'list_reply' ? raw.interactive?.list_reply
      : raw.button || null;
  if (!reply) return null;
  return {
    id: reply.id || reply.payload || null,
    title: reply.title || reply.text || null,
    description: reply.description || null,
    replyType: type || 'button_reply'
  };
}

function mediaFromMessage(json, raw) {
  const source = raw.media || raw.mediaBinding || raw.file || null;
  const type = source?.type || source?.mediaType || (['image', 'video', 'audio', 'document', 'sticker'].includes(json.type) ? json.type : null);
  const url = json.mediaUrl || source?.url || source?.crmUrl || source?.publicUrl || null;
  if (!type && !url && !json.mediaId) return null;
  return {
    type: type || json.type,
    url,
    mimeType: source?.mimeType || null,
    filename: (type === 'document' ? (source?.filename || source?.fileName || source?.originalFilename) : null) || null,
    size: Number(source?.size || source?.fileSize || 0) || null,
    duration: Number(source?.duration || 0) || null,
    voiceNote: Boolean(source?.voiceNote || json.messageType === 'voice'),
    caption: source?.caption ?? null,
    whatsappMediaId: json.mediaId || source?.whatsappMediaId || source?.mediaId || null
  };
}

function normalizeMessagePresentation(message) {
  const json = message?.toJSON ? message.toJSON() : { ...(message || {}) };
  if (!json) return json;
  const raw = json.rawPayload || {};
  const interactiveReply = replyFromRaw(raw);
  const interactive = raw.interactive || (Array.isArray(raw.buttons) ? {
    kind: json.interactiveType || 'button', body: json.text || null,
    footer: raw.footer || null, header: raw.header || null, buttons: raw.buttons
  } : null);
  let body = interactiveReply?.title || json.text || null;
  if (interactiveReply?.title && typeof body === 'string') body = interactiveReply.title;
  const media = mediaFromMessage(json, raw);
  const caption = media && ['image', 'video', 'document'].includes(media.type) ? (raw.media?.caption ?? json.text ?? null) : null;
  const type = json.direction === 'outbound' && json.messageType === 'interactive' ? 'interactive' : json.type;
  return {
    ...json, type, text: body, body, caption, media,
    mediaType: media?.type || null,
    mimeType: media?.mimeType || null,
    fileName: media?.filename || null,
    fileSize: media?.size || null,
    duration: media?.duration || null,
    interactive, interactiveReply
  };
}

module.exports = { normalizeMessagePresentation, replyFromRaw, mediaFromMessage };
