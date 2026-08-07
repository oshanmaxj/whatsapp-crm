import api from './api';

const PREFIX = '/chat';
const pendingGets = new Map();

function deduplicatedGet(key, url, config = {}) {
  const existing = pendingGets.get(key);
  if (existing && !existing.signal?.aborted) return existing.promise;
  const request = api.get(url, config).finally(() => {
    if (pendingGets.get(key)?.promise === request) pendingGets.delete(key);
  });
  pendingGets.set(key, { promise: request, signal: config.signal });
  return request;
}

export const getConversations = (params = {}, config = {}) => deduplicatedGet(
  `conversations:${JSON.stringify(params)}`,
  '/conversations',
  { ...config, params }
);
export const getAssignableUsers = (params = {}) => api.get('/conversations/assignable-users', { params });
export const getConversation = (id, config = {}) => deduplicatedGet(`conversation:${id}`, `/conversations/${id}`, config);
export const updateConversation = (id, payload) => api.patch(`/conversations/${id}`, payload);
export const assignConversation = (id, assignment) => api.post(
  `/conversations/${id}/assign`,
  assignment && typeof assignment === 'object' ? assignment : { assigned_user_id: assignment ?? null }
);
export const setConversationLabels = (id, labels) => api.post(`/conversations/${id}/labels`, { labels });
export const getConversationMessages = (conversationId, config = {}) => deduplicatedGet(
  `messages:${conversationId}`,
  `${PREFIX}/conversations/${conversationId}/messages`,
  config
);
export const sendConversationMessage = (conversationId, payload) => api.post(
  `${PREFIX}/conversations/${conversationId}/messages`,
  typeof payload === 'string' ? { text: payload } : payload
);
export const sendConversationTemplate = (conversationId, payload) => api.post(`${PREFIX}/conversations/${conversationId}/template`, payload);
export const getTemplateDiagnostics = (conversationId, params) => api.get(`${PREFIX}/conversations/${conversationId}/template-diagnostics`, { params });
export const sendConversationInteractive = (conversationId, payload, onUploadProgress) => api.post(
  `${PREFIX}/conversations/${conversationId}/interactive`,
  payload,
  { onUploadProgress }
);
export const getUnreadCount = (config = {}) => deduplicatedGet('unread', `${PREFIX}/unread`, config);
export const markConversationRead = (conversationId, lastReadMessageId = null) => api.post(
  `${PREFIX}/conversations/${conversationId}/read`,
  lastReadMessageId ? { lastReadMessageId } : {}
);
export const sendConversationTyping = (conversationId) => api.post(
  `${PREFIX}/conversations/${conversationId}/typing`,
  { isTyping: true }
);
export const getNotes = (conversationId, config = {}) => deduplicatedGet(
  `notes:${conversationId}`,
  '/notes',
  { ...config, params: { conversationId } }
);
export const createNote = (payload) => api.post('/notes', payload);
export const getMedia = (conversationId, config = {}) => deduplicatedGet(
  `media:${conversationId}`,
  '/media',
  { ...config, params: { conversationId } }
);
export const uploadMedia = (payload, onUploadProgress) => {
  // The shared API interceptor supplies Authorization. Do not set Content-Type
  // for FormData here; Axios/browser must add the multipart boundary.
  return api.post('/media/upload', payload, { onUploadProgress });
};
export const downloadMedia = (id) => api.get(`/media/${id}/download`, { responseType: 'blob' });
export const getTemplates = (params = {}) => api.get('/templates', { params });
export const createTemplate = (payload) => api.post('/templates', payload);
export const getLabels = () => api.get('/labels');
export const createLabel = (payload) => api.post('/labels', payload);
