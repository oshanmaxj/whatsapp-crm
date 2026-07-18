import api from './api';

export const listPaymentSlips = (params = {}) => api.get('/payment-slips', { params });
export const getPaymentSlip = (id) => api.get(`/payment-slips/${id}`);
export const markMessageAsPaymentSlip = (messageId) => api.post(`/payment-slips/messages/${messageId}/mark`);
export const rerunPaymentSlip = (id) => api.post(`/payment-slips/${id}/rerun`);
export const approvePaymentSlip = (id, payload) => api.post(`/payment-slips/${id}/approve`, payload);
export const rejectPaymentSlip = (id, payload) => api.post(`/payment-slips/${id}/reject`, payload);
export const markPaymentSlipDuplicate = (id, payload) => api.post(`/payment-slips/${id}/duplicate`, payload);
export const fetchPaymentSlipFile = (id) => api.get(`/payment-slips/${id}/file`, { responseType: 'blob' });
