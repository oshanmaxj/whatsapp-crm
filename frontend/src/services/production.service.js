import api from './api';

export const getQueue = (params = {}) => api.get('/queue', { params });
export const getQueueStats = () => api.get('/queue/stats');
export const enqueueMessage = (payload) => api.post('/queue', payload);
export const processQueue = (limit = 5) => api.post('/queue/process', { limit });

export const getNotifications = (params = {}) => api.get('/notifications', { params });
export const markNotificationRead = (id) => api.post(`/notifications/${id}/read`);

export const getSettings = () => api.get('/settings');
export const saveSetting = (namespace, key, value) => api.put(`/settings/${namespace}/${key}`, { value });

export const getReportsSummary = () => api.get('/reports/summary');
export const getAuditLogs = (params = {}) => api.get('/audit-logs', { params });
export const getBackups = () => api.get('/backups');
export const exportBackup = () => api.post('/backups/export');
