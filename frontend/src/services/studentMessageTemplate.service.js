import api from './api';

export const listStudentMessageTemplates = () => api.get('/student-message-templates');
export const updateStudentMessageTemplate = (id, payload) => api.patch(`/student-message-templates/${id}`, payload);
export const previewStudentMessageTemplate = (key, variables = {}) => api.post(`/student-message-templates/${key}/preview`, { variables });
export const testStudentMessageTemplate = (key, payload) => api.post(`/student-message-templates/${key}/test`, payload);
export const getStudentOnboardingStatus = (studentId) => api.get(`/student-message-templates/students/${studentId}/onboarding`);
export const sendStudentOnboarding = (studentId, payload = {}) => api.post(`/student-message-templates/students/${studentId}/onboarding`, payload);
export const forceSendStudentOnboarding = (studentId, payload = {}) => api.post(`/student-message-templates/students/${studentId}/onboarding/force`, payload);
