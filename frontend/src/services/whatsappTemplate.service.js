import api from './api';

export const listWhatsAppTemplates = (params = {}) => api.get('/whatsapp-templates', { params });
export const getWhatsAppTemplate = (id) => api.get(`/whatsapp-templates/${id}`);
export const createWhatsAppTemplate = (payload) => api.post('/whatsapp-templates', payload);
export const updateWhatsAppTemplate = (id, payload) => api.patch(`/whatsapp-templates/${id}`, payload);
export const deleteWhatsAppTemplate = (id) => api.delete(`/whatsapp-templates/${id}`);
export const submitWhatsAppTemplate = (id) => api.post(`/whatsapp-templates/${id}/submit`);
export const syncWhatsAppTemplates = (whatsappAccountId) => api.post('/whatsapp-templates/sync', { whatsappAccountId });
export const uploadWhatsAppTemplateSample = (payload) => api.post('/whatsapp-templates/sample-media', payload);
export const getWhatsAppComplianceStatus = () => api.get('/compliance/whatsapp-status');
export const checkWhatsAppMessage = (payload) => api.post('/compliance/message-check', payload);
