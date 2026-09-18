const { flowChannels } = require('./flowChannelCompatibility');

const MATCH_TYPES = new Set(['exact', 'contains', 'starts_with', 'ends_with', 'regex']);
const SOURCES = new Set([
  'inbound_message', 'any_message', 'first_message', 'button_reply', 'interactive_button_reply',
  'list_reply', 'template_button_reply', 'payment_event', 'label_added', 'contact_created',
  'lead_status_changed', 'campaign_response', 'manual',
  'facebook_message_received', 'facebook_comment_received', 'facebook_comment_keyword'
]);

function normalizeText(value, { caseInsensitive = true, trimWhitespace = true } = {}) {
  let text = String(value ?? '').normalize('NFC');
  if (trimWhitespace) text = text.trim().replace(/\s+/gu, ' ');
  return caseInsensitive ? text.toLocaleLowerCase('und') : text;
}

function keywords(value, options) {
  const rows = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(rows.map((item) => normalizeText(item, options)).filter(Boolean))];
}

function keywordMatches(text, configured, matchType = 'contains', options = {}) {
  const normalized = normalizeText(text, options);
  const rows = keywords(configured, options);
  if (!rows.length) return true;
  if (!normalized) return false;
  if (!MATCH_TYPES.has(matchType)) return false;
  return rows.some((keyword) => {
    if (matchType === 'exact') return normalized === keyword;
    if (matchType === 'starts_with') return normalized.startsWith(keyword);
    if (matchType === 'ends_with') return normalized.endsWith(keyword);
    if (matchType === 'regex') {
      if (!options.allowRegex) return false;
      try { return new RegExp(keyword, options.caseInsensitive === false ? 'u' : 'iu').test(normalized); } catch { return false; }
    }
    return normalized.includes(keyword);
  });
}

function sourceMatches(source, event = {}) {
  const type = event.messageType;
  const interactive = event.interactiveType;
  if (!SOURCES.has(source)) return false;
  if (['inbound_message', 'any_message'].includes(source)) return Boolean(event.text || event.buttonPayload);
  if (source === 'first_message') return event.isFirstMessage === true;
  if (['button_reply', 'interactive_button_reply'].includes(source)) return type === 'button_reply' || interactive === 'button_reply' || interactive === 'button';
  if (source === 'list_reply') return interactive === 'list_reply';
  if (source === 'template_button_reply') return event.templateQuickReply === true;
  if (source === 'campaign_response') return Boolean(event.replyToWhatsappMessageId);
  if (source === 'manual') return event.manual === true;
  if (source === 'facebook_message_received') return event.channel === 'facebook_messenger' && Boolean(event.text || event.mediaUrl);
  if (['facebook_comment_received', 'facebook_comment_keyword'].includes(source)) return event.channel === 'facebook_comment';
  return event.eventType === source;
}

// Single source of truth for trigger evaluation, shared by the public boolean
// matchesTrigger() (used for all actual gating decisions — untouched behavior)
// and evaluateTrigger() (used only for diagnostic/observability logging, so a
// rejected candidate's reason can be reported without guessing).
function evaluateTrigger(flow, event = {}, options = {}) {
  // Enforced here (not just at the caller's candidate query) so an unscoped
  // WhatsApp flow can never fire on a Facebook event and vice versa, even if
  // matchesTrigger is ever called directly against an unfiltered flow list.
  // flowChannels() returns the multi-channel `channels` array when a flow
  // has opted into more than one channel, and otherwise falls back to the
  // legacy single `channel` value — so a flow with channels=NULL matches
  // exactly one channel today, unchanged from before multi-channel existed.
  const eventChannel = event.channel || 'whatsapp';
  if (!flowChannels(flow).includes(eventChannel)) return { matched: false, reason: 'CHANNEL_NOT_SCOPED' };
  const config = flow.triggerConfig || {};
  const source = config.source || flow.triggerType || 'inbound_message';
  if (!sourceMatches(source, event)) return { matched: false, reason: 'SOURCE_MISMATCH' };
  // Scoped to the event's own channel: a multi-channel flow legitimately has
  // both whatsappAccountId and facebookPageId set (one per enabled channel),
  // so only the id matching the incoming event's channel is relevant here —
  // otherwise a WhatsApp event on a WhatsApp+Facebook flow would be wrongly
  // rejected by the flow's (irrelevant, for this event) facebookPageId scope.
  if (eventChannel === 'whatsapp') {
    if (flow.whatsappAccountId && String(flow.whatsappAccountId) !== String(event.whatsappAccountId || '')) return { matched: false, reason: 'WHATSAPP_ACCOUNT_SCOPE_MISMATCH' };
  } else if (flow.facebookPageId && String(flow.facebookPageId) !== String(event.facebookPageId || '')) return { matched: false, reason: 'FACEBOOK_PAGE_SCOPE_MISMATCH' };
  if (config.courseId && String(config.courseId) !== String(event.courseId || event.lead?.courseId || '')) return { matched: false, reason: 'COURSE_ID_MISMATCH' };
  if (config.course && normalizeText(config.course) !== normalizeText(event.course || event.lead?.courseInterested || '')) return { matched: false, reason: 'COURSE_NAME_MISMATCH' };
  if (config.campaignId && String(config.campaignId) !== String(event.campaignId || '')) return { matched: false, reason: 'CAMPAIGN_ID_MISMATCH' };
  if (config.contactSource && String(config.contactSource) !== String(event.contactSource || '')) return { matched: false, reason: 'CONTACT_SOURCE_MISMATCH' };
  const configured = config.keywords?.length ? config.keywords : flow.triggerKeywords;
  const keywordMatch = keywordMatches(event.text || event.buttonPayload, configured, config.matchType || config.keywordMatchMode || 'contains', {
    caseInsensitive: config.caseInsensitive !== false,
    trimWhitespace: config.normalizeWhitespace !== false,
    allowRegex: Boolean(options.allowRegex)
  });
  return keywordMatch ? { matched: true, reason: null } : { matched: false, reason: 'KEYWORD_MISMATCH' };
}

function matchesTrigger(flow, event = {}, options = {}) {
  return evaluateTrigger(flow, event, options).matched;
}

module.exports = { normalizeText, keywords, keywordMatches, matchesTrigger, evaluateTrigger, MATCH_TYPES, SOURCES };
