import api from './api';

const BASE_ROUTE = '/contacts';

export const getContacts = (params = {}) => api.get(BASE_ROUTE, { params });
export const getContact = (id) => api.get(`${BASE_ROUTE}/${id}`);
export const createContact = (payload) => api.post(BASE_ROUTE, payload);
export const updateContact = (id, payload) => api.patch(`${BASE_ROUTE}/${id}`, payload);
export const deleteContact = (id) => api.delete(`${BASE_ROUTE}/${id}`);
export const importContactsCsv = (csv) =>
  api.post(`${BASE_ROUTE}/import`, csv, {
    headers: { 'Content-Type': 'text/csv' }
  });
export const exportContactsCsv = (params = {}) =>
  api.get(`${BASE_ROUTE}/export`, {
    params,
    responseType: 'blob'
  });
