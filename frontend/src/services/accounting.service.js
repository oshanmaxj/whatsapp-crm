import api from './api';

export const getAccountingSummary = (params = {}) => api.get('/accounting/summary', { params });
export const getAccountingTransactions = (params = {}) => api.get('/accounting/transactions', { params });
export const getAccountingTransaction = (id) => api.get(`/accounting/transactions/${id}`);
export const createAccountingTransaction = (payload) => api.post('/accounting/transactions', payload);
export const updateAccountingTransaction = (id, payload) => api.patch(`/accounting/transactions/${id}`, payload);
export const deleteAccountingTransaction = (id) => api.delete(`/accounting/transactions/${id}`);
export const getAccountingCategories = (params = {}) => api.get('/accounting/categories', { params });
export const createAccountingCategory = (payload) => api.post('/accounting/categories', payload);
export const updateAccountingCategory = (id, payload) => api.patch(`/accounting/categories/${id}`, payload);
export const deleteAccountingCategory = (id) => api.delete(`/accounting/categories/${id}`);
export const getAccountingReports = (params = {}) => api.get('/accounting/reports', { params });
