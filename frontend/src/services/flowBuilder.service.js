import api from './api';

export const getFlows = () => api.get('/flows');
export const getFlow = (id) => api.get(`/flows/${id}`);
export const createFlow = (payload) => api.post('/flows', payload);
export const updateFlow = (id, payload) => api.patch(`/flows/${id}`, payload);
export const deleteFlow = (id) => api.delete(`/flows/${id}`);
export const saveFlowBuilder = (id, payload) => api.post(`/flows/${id}/save-builder`, payload);
export const publishFlow = (id) => api.post(`/flows/${id}/publish`);
export const testFlow = (id, payload) => api.post(`/flows/${id}/test`, payload);
export const getFlowAnalytics = (id) => api.get(`/flows/${id}/analytics`);
export const getFlowRuns = (id) => api.get(`/flows/${id}/runs`);

export const getGoogleSheetConnections = () => api.get('/google-sheets/connections');
export const createGoogleSheetConnection = (payload) => api.post('/google-sheets/connections', payload);
export const updateGoogleSheetConnection = (id, payload) => api.patch(`/google-sheets/connections/${id}`, payload);
export const deleteGoogleSheetConnection = (id) => api.delete(`/google-sheets/connections/${id}`);
export const sendGoogleSheetTestRow = (payload) => api.post('/google-sheets/test-row', payload);
