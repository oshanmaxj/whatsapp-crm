import api from './api';

export const listPaymentSlips = (params = {}) => api.get('/payment-slips', { params });
export const getPaymentSlip = (id) => api.get(`/payment-slips/${id}`);
export const markMessageAsPaymentSlip = (messageId) => api.post(`/payment-slips/messages/${messageId}/mark`);
export const rerunPaymentSlip = (id) => api.post(`/payment-slips/${id}/rerun`);
export const approvePaymentSlip = (id, payload) => api.post(`/payment-slips/${id}/approve`, payload);
export const rejectPaymentSlip = (id, payload) => api.post(`/payment-slips/${id}/reject`, payload);
export const markPaymentSlipDuplicate = (id, payload) => api.post(`/payment-slips/${id}/duplicate`, payload);
export const fetchPaymentSlipFile = (id) => api.get(`/payment-slips/${id}/file`, { responseType: 'blob' });
export const getStudentFeeOptions = (studentId) => api.get(`/payment-slips/students/${studentId}/fee-options`);
export const getOutstandingInstallments = (feeId) => api.get(`/payment-slips/fees/${feeId}/outstanding-installments`);
export const createStudentFeePlan = (studentId, payload = {}) => api.post(`/payment-slips/students/${studentId}/fee-plan`, payload);
export const generateFeeInstallments = (feeId) => api.post(`/payment-slips/fees/${feeId}/installments`);
