import api from './api';

export const listSmsCampaigns = (params) => api.get('/sms-campaigns', { params });
export const getSmsCampaign = (id) => api.get(`/sms-campaigns/${id}`);
export const listSmsCampaignRecipients = (id, params) => api.get(`/sms-campaigns/${id}/recipients`, { params });
export const getAudienceOptions = () => api.get('/sms-campaigns/audience/options');
export const previewSmsCampaignAudience = (payload) => api.post('/sms-campaigns/audience/preview', payload);
export const createSmsCampaign = (payload) => api.post('/sms-campaigns', payload);
export const updateSmsCampaign = (id, payload) => api.patch(`/sms-campaigns/${id}`, payload);
export const deleteSmsCampaign = (id) => api.delete(`/sms-campaigns/${id}`);
export const sendSmsCampaignNow = (id) => api.post(`/sms-campaigns/${id}/send`);
export const scheduleSmsCampaign = (id, scheduledAt) => api.post(`/sms-campaigns/${id}/schedule`, { scheduledAt });
export const pauseSmsCampaign = (id) => api.post(`/sms-campaigns/${id}/pause`);
export const resumeSmsCampaign = (id) => api.post(`/sms-campaigns/${id}/resume`);
export const cancelSmsCampaign = (id) => api.post(`/sms-campaigns/${id}/cancel`);
export const retrySmsCampaign = (id) => api.post(`/sms-campaigns/${id}/retry`);
