import api from './api';

export const getFacebookConversations = (facebookPageId = null) => api.get('/facebook-messenger/conversations', { params: facebookPageId ? { facebookPageId } : {} });
export const getFacebookConversationMessages = (conversationId, params = {}) => api.get(`/facebook-messenger/conversations/${conversationId}/messages`, { params });
export const sendFacebookMessage = (conversationId, text, clientMessageId = null) => api.post(`/facebook-messenger/conversations/${conversationId}/messages`, { text, clientMessageId });
