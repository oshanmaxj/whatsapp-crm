// Generic {{var}} interpolation — provider- and channel-neutral, usable by
// SMS campaigns today and anything else later. A missing/undefined
// variable resolves to an empty string rather than leaving "undefined" or
// the raw "{{token}}" in the sent message.
function interpolateTemplate(template, values = {}) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const value = values[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

module.exports = { interpolateTemplate };
