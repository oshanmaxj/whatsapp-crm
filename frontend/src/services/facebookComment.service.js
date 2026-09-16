import api from './api';

export const getFacebookComments = (facebookPageId = null) => api.get('/facebook-comments', { params: facebookPageId ? { facebookPageId } : {} });
export const getFacebookComment = (id) => api.get(`/facebook-comments/${id}`);
export const replyToFacebookComment = (id, message) => api.post(`/facebook-comments/${id}/reply`, { message });
