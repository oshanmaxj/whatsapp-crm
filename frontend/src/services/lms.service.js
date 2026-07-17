import api from './api';

export const listLmsLessons = (params = {}) => api.get('/lms/lessons', { params });
export const createLmsLesson = (payload) => api.post('/lms/lessons', payload);
export const updateLmsLesson = (id, payload) => api.patch(`/lms/lessons/${id}`, payload);
export const deleteLmsLesson = (id) => api.delete(`/lms/lessons/${id}`);
export const publishLmsLesson = (id, published) => api.post(`/lms/lessons/${id}/${published ? 'publish' : 'unpublish'}`);
export const addLmsMaterial = (id, payload) => api.post(`/lms/lessons/${id}/materials`, payload);
export const uploadLmsMaterialFile = (file) => api.post('/lms/materials/upload', file, {
  headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': file.name }
});
export const deleteLmsMaterial = (id) => api.delete(`/lms/materials/${id}`);
export const listLmsCourses = (params = {}) => api.get('/lms/courses', { params });
export const getLmsCourse = (id) => api.get(`/lms/courses/${id}`);
export const createLmsCourse = (payload) => api.post('/lms/courses', payload);
export const updateLmsCourse = (id, payload) => api.patch(`/lms/courses/${id}`, payload);
export const archiveLmsCourse = (id) => api.delete(`/lms/courses/${id}`);
export const duplicateLmsCourse = (id) => api.post(`/lms/courses/${id}/duplicate`);
export const getLmsCurriculum = (id) => api.get(`/lms/courses/${id}/curriculum`);
export const createLmsTopic = (courseId, payload) => api.post(`/lms/courses/${courseId}/topics`, payload);
export const updateLmsTopic = (id, payload) => api.patch(`/lms/topics/${id}`, payload);
export const archiveLmsTopic = (id) => api.delete(`/lms/topics/${id}`);
export const duplicateLmsTopic = (id) => api.post(`/lms/topics/${id}/duplicate`);
export const reorderLmsTopics = (items) => api.post('/lms/topics/reorder', { items });
export const createBuilderLesson = (topicId, payload) => api.post(`/lms/topics/${topicId}/lessons`, payload);
export const getBuilderLesson = (id) => api.get(`/lms/builder-lessons/${id}`);
export const updateBuilderLesson = (id, payload) => api.patch(`/lms/builder-lessons/${id}`, payload);
export const archiveBuilderLesson = (id) => api.delete(`/lms/builder-lessons/${id}`);
export const duplicateBuilderLesson = (id) => api.post(`/lms/builder-lessons/${id}/duplicate`);
export const moveBuilderLesson = (id, topicId, sortOrder = 0) => api.post(`/lms/builder-lessons/${id}/move`, { topicId, sortOrder });
export const reorderBuilderLessons = (items) => api.post('/lms/builder-lessons/reorder', { items });
