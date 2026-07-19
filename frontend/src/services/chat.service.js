import api from './api';

const PREFIX = '/chat';

export const getConversations = (params = {}) => api.get('/conversations', { params });
export const getAssignableUsers = (params = {}) => api.get('/conversations/assignable-users', { params });
export const getConversation = (id) => api.get(`/conversations/${id}`);
export const updateConversation = (id, payload) => api.patch(`/conversations/${id}`, payload);
export const assignConversation = (id, assignment) => api.post(
  `/conversations/${id}/assign`,
  assignment && typeof assignment === 'object' ? assignment : { assigned_user_id: assignment ?? null }
);
export const setConversationLabels = (id, labels) => api.post(`/conversations/${id}/labels`, { labels });
export const getConversationMessages = (conversationId) => api.get(`${PREFIX}/conversations/${conversationId}/messages`);
export const sendConversationMessage = (conversationId, payload) => api.post(
  `${PREFIX}/conversations/${conversationId}/messages`,
  typeof payload === 'string' ? { text: payload } : payload
);
export const sendConversationTemplate = (conversationId, payload) => api.post(`${PREFIX}/conversations/${conversationId}/template`, payload);
export const sendConversationInteractive = (conversationId, payload, onUploadProgress) => api.post(
  `${PREFIX}/conversations/${conversationId}/interactive`,
  payload,
  { onUploadProgress }
);
export const getUnreadCount = () => api.get(`${PREFIX}/unread`);
export const getNotes = (conversationId) => api.get('/notes', { params: { conversationId } });
export const createNote = (payload) => api.post('/notes', payload);
export const getMedia = (conversationId) => api.get('/media', { params: { conversationId } });
export const uploadMedia = (payload) => {
  // The shared API interceptor supplies Authorization. Do not set Content-Type
  // for FormData here; Axios/browser must add the multipart boundary.
  return api.post('/media/upload', payload);
};
export const downloadMedia = (id) => api.get(`/media/${id}/download`, { responseType: 'blob' });
export const getTemplates = (params = {}) => api.get('/templates', { params });
export const createTemplate = (payload) => api.post('/templates', payload);
export const getLabels = () => api.get('/labels');
export const createLabel = (payload) => api.post('/labels', payload);
