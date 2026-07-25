import api from './api';
export const listAiProviders=()=>api.get('/ai-providers');
export const saveAiProvider=(id,payload)=>id?api.patch(`/ai-providers/${id}`,payload):api.post('/ai-providers',payload);
export const testAiProvider=id=>api.post(`/ai-providers/${id}/test`);
export const defaultAiProvider=id=>api.post(`/ai-providers/${id}/default`);
export const removeAiProviderKey=id=>api.delete(`/ai-providers/${id}/key`);
