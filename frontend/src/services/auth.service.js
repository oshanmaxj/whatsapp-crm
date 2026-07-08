import api from './api';

export const login = (payload) => api.post('/auth/login', payload);
export const requestPasswordReset = (payload) => api.post('/auth/password/forgot', payload);
export const resetPassword = (payload) => api.post('/auth/password/reset', payload);
export const getMe = () => api.get('/auth/me');
export const updateMe = (payload) => api.patch('/auth/me', payload);
export const changePassword = (payload) => api.post('/auth/change-password', payload);
