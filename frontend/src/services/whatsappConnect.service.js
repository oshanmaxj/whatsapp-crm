import api from './api';

export const getWhatsappSettings = () => api.get('/whatsapp/settings');
export const saveWhatsappSettings = (payload) => api.put('/whatsapp/settings', payload);
export const testWhatsappConnection = () => api.post('/whatsapp/test-connection');
export const testWhatsappSend = (payload) => api.post('/whatsapp/test-send', payload);
