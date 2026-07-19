import api from './api';

export const getFlows = () => api.get('/flows');
export const getFlow = (id) => api.get(`/flows/${id}`);
export const createFlow = (payload) => api.post('/flows', payload);
export const updateFlow = (id, payload) => api.patch(`/flows/${id}`, payload);
export const deleteFlow = (id) => api.delete(`/flows/${id}`);
export const saveFlowBuilder = (id, payload) => api.post(`/flows/${id}/save-builder`, payload);
function base64Blob(dataBase64, mimeType) {
  const binary = atob(String(dataBase64 || '').replace(/^data:[^;]+;base64,/, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType || 'application/octet-stream' });
}

export const uploadFlowMedia = (id, payload, config = {}) => {
  const form = new FormData();
  const fileName = payload.fileName || 'flow-media';
  const mimeType = payload.mimeType || 'application/octet-stream';
  form.append('file', base64Blob(payload.dataBase64, mimeType), fileName);
  if (payload.whatsappAccountId) form.append('whatsappAccountId', String(payload.whatsappAccountId));
  if (payload.mediaType) form.append('mediaType', payload.mediaType);
  return api.post(`/flows/${id}/media`, form, { timeout: 120000, ...config });
};

export function flowMediaUploadError(error, mediaType = 'file') {
  const status = error?.response?.status;
  const data = error?.response?.data;
  const code = data?.error || data?.code;
  if (code === 'FILE_TOO_LARGE' || status === 413) {
    if (typeof data?.message === 'string' && data.message) return data.message;
    return `The ${mediaType} upload was rejected by Nginx or an upstream proxy because the request is too large.`;
  }
  if (code === 'INTERACTIVE_MEDIA_MIME_UNSUPPORTED') return data.message || `Unsupported ${mediaType} type.`;
  if (code === 'MEDIA_STORAGE_FAILED') return data.message || 'CRM storage failed while saving the media.';
  if (error?.code === 'ECONNABORTED' || /timeout/i.test(error?.message || '')) return 'Media upload timed out after 120 seconds. Check the proxy body timeout and connection.';
  if (!error?.response) return 'The upload was blocked before it reached CRM, likely by Nginx or an upstream proxy. Verify the active HTTPS server block and proxy limits.';
  return data?.message || error.message || 'Media upload failed.';
}
export const publishFlow = (id) => api.post(`/flows/${id}/publish`);
export const unpublishFlow = (id) => api.post(`/flows/${id}/unpublish`);
export const duplicateFlow = (id) => api.post(`/flows/${id}/duplicate`);
export const testFlow = (id, payload) => api.post(`/flows/${id}/test`, payload);
export const getFlowAnalytics = (id) => api.get(`/flows/${id}/analytics`);
export const getFlowRuns = (id) => api.get(`/flows/${id}/runs`);
export const getFlowLogs = (id) => api.get(`/flows/${id}/logs`);
export const getFlowStats = (id) => api.get(`/flows/${id}/stats`);
export const getFlowActionOptions = (currentFlowId) => api.get('/flows/action-options', { params: { currentFlowId } });
export const validateFlow = (id) => api.get(`/flows/${id}/validate`);
export const simulateFlowTrigger = (id, payload) => api.post(`/flows/${id}/simulate-trigger`, payload);

export const getGoogleSheetConnections = () => api.get('/google-sheets/connections');
export const createGoogleSheetConnection = (payload) => api.post('/google-sheets/connections', payload);
export const updateGoogleSheetConnection = (id, payload) => api.patch(`/google-sheets/connections/${id}`, payload);
export const deleteGoogleSheetConnection = (id) => api.delete(`/google-sheets/connections/${id}`);
export const sendGoogleSheetTestRow = (payload) => api.post('/google-sheets/test-row', payload);
