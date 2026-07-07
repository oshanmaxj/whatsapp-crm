import api from './api';

export const listNotificationTemplates = () => api.get('/notification-templates');
export const getNotificationTemplate = (key) => api.get(`/notification-templates/${key}`);
export const updateNotificationTemplate = (id, payload) => api.patch(`/notification-templates/${id}`, payload);
export const previewNotificationTemplate = (key, variables = {}) => api.post(`/notification-templates/${key}/preview`, { variables });
