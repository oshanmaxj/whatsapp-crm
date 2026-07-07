import api from './api';

export const listStudentMessageTemplates = () => api.get('/student-message-templates');
export const updateStudentMessageTemplate = (id, payload) => api.patch(`/student-message-templates/${id}`, payload);
export const previewStudentMessageTemplate = (key, variables = {}) => api.post(`/student-message-templates/${key}/preview`, { variables });
export const testStudentMessageTemplate = (key, payload) => api.post(`/student-message-templates/${key}/test`, payload);
