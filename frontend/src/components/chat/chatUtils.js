import { API_ORIGIN } from '../../config/apiConfig';

export function safeArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

export function contactName(contact) {
  if (!contact) return 'Unknown contact';
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ')
    || contact.phone
    || 'Unnamed contact';
}

export function agentName(agent) {
  if (!agent) return 'Unassigned';
  return agent.name
    || [agent.firstName, agent.lastName].filter(Boolean).join(' ')
    || agent.email
    || 'Unassigned';
}

export function initials(contact) {
  const name = contactName(contact);
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function resolveMediaUrl(mediaUrl) {
  if (!mediaUrl) return '';
  if (/^(https?:\/\/|blob:|data:)/i.test(mediaUrl)) return mediaUrl;
  return `${API_ORIGIN}${mediaUrl.startsWith('/') ? '' : '/'}${mediaUrl}`;
}

export function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function formatDateTime(value, fallback = 'Not available') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? fallback
    : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function messagePreview(message) {
  if (!message) return 'No messages yet';
  if (message.text) return message.text;
  if (message.templateName) return `Template: ${message.templateName}`;
  const labels = {
    image: 'Photo',
    video: 'Video',
    audio: 'Audio',
    document: 'Document',
    sticker: 'Sticker',
    location: 'Location'
  };
  return labels[message.type] || 'Message';
}
