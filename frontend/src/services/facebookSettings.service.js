import api from './api';

export const getFacebookSettings = () => api.get('/settings/facebook');
export const saveFacebookSettings = (payload) => api.patch('/settings/facebook', payload);
export const generateFacebookVerifyToken = () => api.post('/settings/facebook/generate-verify-token');
export const testFacebookConfiguration = () => api.post('/settings/facebook/test');
