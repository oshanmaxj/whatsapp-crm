function component(rows, type) {
  return (Array.isArray(rows) ? rows : []).find((row) => String(row?.type || '').toLowerCase() === type);
}

function parameterText(parameter) {
  if (parameter == null) return null;
  if (parameter.text != null) return String(parameter.text);
  if (parameter.payload != null) return String(parameter.payload);
  return null;
}

function resolveText(text, parameters = []) {
  return String(text || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (placeholder, index) => {
    const value = parameterText(parameters[Number(index) - 1]);
    return value == null ? placeholder : value;
  });
}

function createTemplateSnapshot(template, components = []) {
  const rows = Array.isArray(components) ? components : [];
  const bodyParameters = component(rows, 'body')?.parameters || [];
  const headerParameters = component(rows, 'header')?.parameters || [];
  return {
    name: template?.name || null,
    language: template?.language || 'en_US',
    header: {
      type: String(template?.headerType || 'NONE').toUpperCase(),
      text: resolveText(template?.headerContent, headerParameters),
      parameters: headerParameters
    },
    body: resolveText(template?.body, bodyParameters),
    footer: template?.footer || null,
    buttons: Array.isArray(template?.buttons) ? template.buttons.map((button) => ({
      type: button.type || button.buttonType || null,
      text: button.text || button.title || button.label || null,
      url: button.url || null
    })) : [],
    components: rows
  };
}

function renderTemplateSnapshot(snapshot) {
  if (!snapshot) return null;
  const lines = [];
  if (snapshot.header?.type === 'TEXT' && snapshot.header.text) lines.push(snapshot.header.text);
  else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(snapshot.header?.type)) lines.push(`[${snapshot.header.type.charAt(0)}${snapshot.header.type.slice(1).toLowerCase()}]`);
  if (snapshot.body) lines.push(snapshot.body);
  if (snapshot.footer) lines.push(snapshot.footer);
  const labels = (snapshot.buttons || []).map((button) => button.text).filter(Boolean);
  if (labels.length) lines.push(labels.join(' · '));
  return lines.join('\n\n') || null;
}

function snapshotFromRaw(raw = {}) {
  return raw.templateSnapshot || raw.template?.snapshot || null;
}

module.exports = { createTemplateSnapshot, renderTemplateSnapshot, snapshotFromRaw, resolveText };
