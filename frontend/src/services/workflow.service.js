import api from './api';

export const getWorkflows = () => api.get('/workflows');
export const getWorkflow = (id) => api.get(`/workflows/${id}`);
export const createWorkflow = (payload) => api.post('/workflows', payload);
export const updateWorkflow = (id, payload) => api.patch(`/workflows/${id}`, payload);
export const deleteWorkflow = (id) => api.delete(`/workflows/${id}`);
export const testWorkflow = (id, payload = {}) => api.post(`/workflows/${id}/test`, payload);
