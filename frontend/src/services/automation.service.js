import api from './api';

export const getAutomations = (params = {}) => api.get('/automations', { params });
export const getAutomation = (id) => api.get(`/automations/${id}`);
export const updateAutomation = (id, payload) => api.patch(`/automations/${id}`, payload);
export const toggleAutomation = (id, enabled) => api.post(`/automations/${id}/toggle`, { enabled });
export const runAutomation = (id) => api.post(`/automations/${id}/run`);
export const getAutomationStats = () => api.get('/automations/stats');
