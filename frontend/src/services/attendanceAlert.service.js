import api from './api';

export const listAttendanceAlerts = (params = {}) => api.get('/attendance-alerts', { params });
export const getDueAttendanceAlerts = () => api.get('/attendance-alerts/due');
export const sendAttendanceAlert = (studentId, payload = {}) => api.post(`/attendance-alerts/send/${studentId}`, payload);
export const sendBulkAttendanceAlerts = () => api.post('/attendance-alerts/send-bulk');
export const getAttendanceAlertHistory = (params = {}) => api.get('/attendance-alerts/history', { params });
export const getAttendanceAlertReport = (params = {}) => api.get('/attendance-alerts/report', { params });
