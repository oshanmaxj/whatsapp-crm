import api from './api';

export const getCampaigns = (params = {}) => api.get('/campaigns', { params });
export const getCampaign = (id) => api.get(`/campaigns/${id}`);
export const createCampaign = (payload) => api.post('/campaigns', payload);
export const updateCampaign = (id, payload) => api.patch(`/campaigns/${id}`, payload);
export const deleteCampaign = (id) => api.delete(`/campaigns/${id}`);
export const sendCampaign = (id) => api.post(`/campaigns/${id}/send`);
export const scheduleCampaign = (id, scheduledAt) => api.post(`/campaigns/${id}/schedule`, { scheduledAt });
export const importCampaignRecipients = (id, payload) => api.post(`/campaigns/${id}/recipients/import`, payload);
export const cancelCampaign = (id) => api.post(`/campaigns/${id}/cancel`);
export const getCampaignAnalytics = (id) => api.get(`/campaigns/${id}/analytics`);
export const previewAudience = (params = {}) => api.get('/campaigns/audience/preview', { params });
export const previewBroadcastAudience = (payload = {}) => api.post('/campaigns/audience/preview', payload);
export const getCampaignAudienceOptions = () => api.get('/campaigns/audience/options');
