const MATCH_TYPES = new Set(['exact', 'contains', 'starts_with', 'ends_with', 'regex']);
const SOURCES = new Set([
  'inbound_message', 'any_message', 'first_message', 'button_reply', 'interactive_button_reply',
  'list_reply', 'template_button_reply', 'payment_event', 'label_added', 'contact_created',
  'lead_status_changed', 'campaign_response', 'manual'
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
  return event.eventType === source;
}

function matchesTrigger(flow, event = {}, options = {}) {
  const config = flow.triggerConfig || {};
  const source = config.source || flow.triggerType || 'inbound_message';
  if (!sourceMatches(source, event)) return false;
  if (flow.whatsappAccountId && String(flow.whatsappAccountId) !== String(event.whatsappAccountId || '')) return false;
  if (config.courseId && String(config.courseId) !== String(event.courseId || event.lead?.courseId || '')) return false;
  if (config.course && normalizeText(config.course) !== normalizeText(event.course || event.lead?.courseInterested || '')) return false;
  if (config.campaignId && String(config.campaignId) !== String(event.campaignId || '')) return false;
  if (config.contactSource && String(config.contactSource) !== String(event.contactSource || '')) return false;
  const configured = config.keywords?.length ? config.keywords : flow.triggerKeywords;
  return keywordMatches(event.text || event.buttonPayload, configured, config.matchType || config.keywordMatchMode || 'contains', {
    caseInsensitive: config.caseInsensitive !== false,
    trimWhitespace: config.normalizeWhitespace !== false,
    allowRegex: Boolean(options.allowRegex)
  });
}

module.exports = { normalizeText, keywords, keywordMatches, matchesTrigger, MATCH_TYPES, SOURCES };
