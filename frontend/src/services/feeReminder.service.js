import api from './api';

export const listFeeReminders = (params = {}) => api.get('/fee-reminders', { params });
export const getDueFeeReminders = () => api.get('/fee-reminders/due');
export const sendFeeReminder = (installmentId) => api.post(`/fee-reminders/send/${installmentId}`);
export const sendBulkFeeReminders = () => api.post('/fee-reminders/send-bulk');
export const getFeeReminderHistory = (params = {}) => api.get('/fee-reminders/history', { params });
