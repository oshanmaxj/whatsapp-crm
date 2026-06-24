import api from './api';

export const getAppointments = (params = {}) => api.get('/appointments', { params });
export const getAppointment = (id) => api.get(`/appointments/${id}`);
export const createAppointment = (payload) => api.post('/appointments', payload);
export const updateAppointment = (id, payload) => api.patch(`/appointments/${id}`, payload);
export const deleteAppointment = (id) => api.delete(`/appointments/${id}`);
export const confirmAppointment = (id) => api.post(`/appointments/${id}/confirm`);
export const cancelAppointment = (id, reason) => api.post(`/appointments/${id}/cancel`, { reason });
export const sendAppointmentReminder = (id) => api.post(`/appointments/${id}/reminder`);
