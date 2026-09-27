// Converts a WhatsApp List Message node's configuration into a Messenger-
// compatible send plan. This is the ONLY place that decides which Messenger
// format (Quick Replies / Generic Template carousel / Button Template)
// represents a given list, so flow.service.js's execution path and its
// design-time validation warnings (validateFlow) both stay in sync with the
// exact same rules instead of duplicating them.
//
// Current Meta limits this was written against (Messenger Send API, Graph
// API v21.0+, verified against developers.facebook.com/docs/messenger-platform
// at implementation time — these are stable, long-standing Send API limits,
// not versioned/deprecated behavior):
//   Quick Replies:     max 13 per message, title <= 20 chars, payload <= 1000 chars.
//   Generic Template:  max 10 elements, title <= 80 chars, subtitle <= 80 chars,
//                       max 3 buttons per element.
//   Button Template:   max 3 buttons, title <= 20 chars, text <= 640 chars.
// The deprecated Messenger "List Template" is deliberately never used.
const MAX_QUICK_REPLIES = 13;
const MAX_QUICK_REPLY_TITLE = 20;
const MAX_CAROUSEL_ELEMENTS = 10;
const MAX_CAROUSEL_TEXT = 80;
const MAX_BUTTON_TEMPLATE_OPTIONS = 3;

function encodedPayload(flowId, nodeKey, optionId) {
  return `flowbtn:${flowId}:${nodeKey}:${optionId}`.slice(0, 256);
}

// Flattens WhatsApp's sections+rows structure into one ordered list of
// options. Section titles are not carried into any Messenger format (none of
// Quick Replies, Generic Template or Button Template has a sub-grouping
// concept) — this is a documented, deliberate structural loss; the options
// themselves, their order, their titles/descriptions and their stable IDs
// are always fully preserved.
function flattenOptions(sections = []) {
  const options = [];
  for (const section of sections) {
    for (const row of section.rows || []) {
      const id = String(row.id || row.payload || '').trim();
      if (!id) continue;
      options.push({
        id,
        title: String(row.title || row.label || '').trim(),
        description: String(row.description || '').trim() || null
      });
    }
  }
  return options;
}

function unconvertible(reason, details = {}) {
  return Object.assign(new Error(reason), { code: 'FACEBOOK_LIST_MESSAGE_UNCONVERTIBLE', status: 422, ...details });
}

// Pure decision function — no network/DB access — so it can be reused
// unchanged by both real execution (flow.service.js) and design-time
// validation (validateFlow's Messenger-aware warnings), and unit-tested
// directly without mocking Meta's API.
function planMessengerListMessage({ sections = [], flowId, nodeKey }) {
  const options = flattenOptions(sections);
  if (!options.length) throw unconvertible('This list message has no options to send.');

  for (const option of options) {
    if (!option.title) throw unconvertible(`Option "${option.id}" is missing a title.`, { optionId: option.id });
  }

  const hasDescriptions = options.some((option) => option.description);
  const maxTitleLength = Math.max(...options.map((option) => option.title.length));
  const count = options.length;

  const encode = (option) => ({ ...option, payload: encodedPayload(flowId, nodeKey, option.id) });

  if (hasDescriptions || maxTitleLength > MAX_QUICK_REPLY_TITLE) {
    // Needs the richer format: a description, or a title too long for a
    // Quick Reply/Button Template button (both cap at 20 characters).
    if (maxTitleLength > MAX_CAROUSEL_TEXT) {
      throw unconvertible(
        `Option title exceeds ${MAX_CAROUSEL_TEXT} characters, which no supported Messenger format can display.`,
        { limit: MAX_CAROUSEL_TEXT, actual: maxTitleLength }
      );
    }
    if (count > MAX_CAROUSEL_ELEMENTS) {
      throw unconvertible(
        `This list has ${count} options with descriptions or long titles; Messenger's carousel supports at most ${MAX_CAROUSEL_ELEMENTS}.`,
        { limit: MAX_CAROUSEL_ELEMENTS, actual: count }
      );
    }
    return { format: 'generic_template', options: options.map(encode) };
  }

  // Simple, short, description-free options.
  if (count <= MAX_BUTTON_TEMPLATE_OPTIONS) {
    // Small set: Button Template buttons stay attached to their message
    // permanently (re-tappable from scrollback later), which is the closer
    // match to a WhatsApp list message's own re-tappable behavior.
    return { format: 'button_template', options: options.map(encode) };
  }
  if (count <= MAX_QUICK_REPLIES) {
    return { format: 'quick_replies', options: options.map(encode) };
  }
  throw unconvertible(
    `This list has ${count} simple text options; Messenger's Quick Replies support at most ${MAX_QUICK_REPLIES}.`,
    { limit: MAX_QUICK_REPLIES, actual: count }
  );
}

module.exports = {
  MAX_QUICK_REPLIES,
  MAX_QUICK_REPLY_TITLE,
  MAX_CAROUSEL_ELEMENTS,
  MAX_CAROUSEL_TEXT,
  MAX_BUTTON_TEMPLATE_OPTIONS,
  flattenOptions,
  planMessengerListMessage
};
