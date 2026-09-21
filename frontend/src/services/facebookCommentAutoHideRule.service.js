import api from './api';

export const listAutoHideRules = (facebookPageId = null) => api.get('/facebook-comment-auto-hide-rules', { params: facebookPageId ? { facebookPageId } : {} });
export const createAutoHideRule = (payload) => api.post('/facebook-comment-auto-hide-rules', payload);
export const updateAutoHideRule = (id, payload) => api.patch(`/facebook-comment-auto-hide-rules/${id}`, payload);
export const deleteAutoHideRule = (id) => api.delete(`/facebook-comment-auto-hide-rules/${id}`);
export const getAutoHideSettings = () => api.get('/facebook-comment-auto-hide-rules/settings');
export const updateAutoHideSettings = (enabled) => api.patch('/facebook-comment-auto-hide-rules/settings', { enabled });
