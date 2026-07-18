import api from './api';

export const listReceipts = (params = {}) => api.get('/receipts', { params });
export const getReceipt = (id) => api.get(`/receipts/${id}`);
export const verifyReceipt = (token) => api.get(`/receipts/verify/${encodeURIComponent(token)}`);
export const generateReceipt = (paymentId, generationSource = 'ADMIN_REGENERATE') => api.post(`/receipts/payments/${paymentId}/generate`, { generationSource });
export const downloadReceipt = (id) => api.get(`/receipts/${id}/pdf`, { responseType: 'blob' });
export const regenerateReceipt = (id) => api.post(`/receipts/${id}/regenerate`);
export const sendReceiptWhatsapp = (id) => api.post(`/receipts/${id}/send-whatsapp`);
export const voidReceipt = (id, reason) => api.post(`/receipts/${id}/void`, { reason });
export const getReceiptReport = (params = {}) => api.get('/receipts/report', { params });
export const exportReceipts = (params = {}) => api.get('/receipts/export', { params, responseType: 'blob' });
export const getReceiptSettings = () => api.get('/receipts/settings');
export const updateReceiptSettings = (payload) => api.put('/receipts/settings', payload);

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
