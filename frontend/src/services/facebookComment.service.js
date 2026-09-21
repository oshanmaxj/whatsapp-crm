import api from './api';

export const getFacebookComments = (facebookPageId = null) => api.get('/facebook-comments', { params: facebookPageId ? { facebookPageId } : {} });
export const getFacebookComment = (id) => api.get(`/facebook-comments/${id}`);
export const replyToFacebookComment = (id, message) => api.post(`/facebook-comments/${id}/reply`, { message });
export const hideFacebookComment = (id) => api.post(`/facebook-comments/${id}/hide`);
export const unhideFacebookComment = (id) => api.post(`/facebook-comments/${id}/unhide`);
export const retryFacebookCommentAutoHide = (id) => api.post(`/facebook-comments/${id}/auto-hide/retry`);
