import api from './api';

export const listBirthdayWishes = (params = {}) => api.get('/birthday-wishes', { params });
export const getDueBirthdayWishes = () => api.get('/birthday-wishes/due');
export const sendBirthdayWish = (studentId, payload = {}) => api.post(`/birthday-wishes/send/${studentId}`, payload);
export const sendBulkBirthdayWishes = () => api.post('/birthday-wishes/send-bulk');
export const getBirthdayWishHistory = (params = {}) => api.get('/birthday-wishes/history', { params });
export const getBirthdayWishReport = (params = {}) => api.get('/birthday-wishes/report', { params });
