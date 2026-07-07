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
