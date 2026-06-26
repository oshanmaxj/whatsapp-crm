import api from './api';

export const listClassReminders = (params = {}) => api.get('/class-reminders', { params });
export const getDueClassReminders = () => api.get('/class-reminders/due');
export const sendClassReminder = (batchId) => api.post(`/class-reminders/send/${batchId}`);
export const sendBulkClassReminders = () => api.post('/class-reminders/send-bulk');
export const getClassReminderHistory = (params = {}) => api.get('/class-reminders/history', { params });
export const getClassReminderReport = (params = {}) => api.get('/class-reminders/report', { params });
