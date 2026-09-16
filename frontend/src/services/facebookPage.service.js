import api from './api';

export const getFacebookPages = (includeInactive = false) => api.get('/facebook-pages', { params: includeInactive ? { includeInactive: true } : {} });
export const getFacebookPage = (id) => api.get(`/facebook-pages/${id}`);
export const createFacebookPage = (payload) => api.post('/facebook-pages', payload);
export const updateFacebookPage = (id, payload) => api.patch(`/facebook-pages/${id}`, payload);
export const verifyFacebookPage = (id) => api.post(`/facebook-pages/${id}/verify`);
export const subscribeFacebookPageWebhook = (id) => api.post(`/facebook-pages/${id}/subscribe-webhook`);
export const deactivateFacebookPage = (id) => api.post(`/facebook-pages/${id}/deactivate`);
