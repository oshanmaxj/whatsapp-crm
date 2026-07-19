import api from './api';

export const getWhatsAppAccounts = (includeInactive = false) => api.get('/whatsapp-accounts', { params: includeInactive ? { includeInactive: true } : {} });
export const getWhatsAppAccount = (id) => api.get(`/whatsapp-accounts/${id}`);
export const createWhatsAppAccount = (payload) => api.post('/whatsapp-accounts', payload);
export const updateWhatsAppAccount = (id, payload) => api.patch(`/whatsapp-accounts/${id}`, payload);
export const deactivateWhatsAppAccount = (id) => api.delete(`/whatsapp-accounts/${id}`);
export const setDefaultWhatsAppAccount = (id) => api.post(`/whatsapp-accounts/${id}/set-default`);
export const testWhatsAppAccount = (id) => api.post(`/whatsapp-accounts/${id}/test-connection`);
export const checkWhatsAppWebhook = (id) => api.get(`/whatsapp-accounts/${id}/webhook-subscription`);
export const subscribeWhatsAppWebhook = (id) => api.post(`/whatsapp-accounts/${id}/webhook-subscription`);
export const overrideWhatsAppWebhook = (id) => api.post(`/whatsapp-accounts/${id}/webhook-callback-override`);
