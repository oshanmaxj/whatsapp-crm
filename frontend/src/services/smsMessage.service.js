import api from './api';

export const listSmsMessages = (params) => api.get('/sms/messages', { params });
export const getSmsMessage = (id) => api.get(`/sms/messages/${id}`);
