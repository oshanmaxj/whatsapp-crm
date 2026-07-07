import api from './api';

export const listCourseSchedules = (params = {}) => api.get('/course-schedules', { params });
export const getCourseSchedule = (id) => api.get(`/course-schedules/${id}`);
export const createCourseSchedule = (payload) => api.post('/course-schedules', payload);
export const updateCourseSchedule = (id, payload) => api.patch(`/course-schedules/${id}`, payload);
export const deleteCourseSchedule = (id) => api.delete(`/course-schedules/${id}`);
export const generateScheduleLessons = (id) => api.post(`/course-schedules/${id}/generate-lessons`);
export const listScheduledLessons = (params = {}) => api.get('/scheduled-lessons', { params });
export const updateScheduledLesson = (id, payload) => api.patch(`/scheduled-lessons/${id}`, payload);
export const cancelScheduledLesson = (id) => api.post(`/scheduled-lessons/${id}/cancel`);
export const importZoomRecordings = (payload = {}) => api.post('/zoom-recordings/import', payload);
export const listZoomRecordingImports = (params = {}) => api.get('/zoom-recordings/imports', { params });
export const getZoomSettings = () => api.get('/zoom-integration/settings');
export const updateZoomSettings = (payload) => api.patch('/zoom-integration/settings', payload);
