import api from './api';

const BASE_ROUTE = '/leads';

export const getLeads = (params = {}) => api.get(BASE_ROUTE, { params });
export const getLead = (id) => api.get(`${BASE_ROUTE}/${id}`);
export const createLead = (payload) => api.post(BASE_ROUTE, payload);
export const updateLead = (id, payload) => api.patch(`${BASE_ROUTE}/${id}`, payload);
export const updateLeadStatus = (id, payload) => api.patch(`${BASE_ROUTE}/${id}/status`, payload);
export const deleteLead = (id) => api.delete(`${BASE_ROUTE}/${id}`);
export const assignLead = (id, payload) => api.post(`${BASE_ROUTE}/${id}/assign`, payload);
export const autoAssignLeads = (payload = {}) => api.post(`${BASE_ROUTE}/auto-assign`, payload);
