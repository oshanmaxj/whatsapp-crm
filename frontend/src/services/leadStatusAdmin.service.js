import api from './api';
export const listLeadStatuses=()=>api.get('/lead-statuses');
export const createLeadStatus=payload=>api.post('/lead-statuses',payload);
export const updateLeadStatus=(id,payload)=>api.patch(`/lead-statuses/${id}`,payload);
export const disableLeadStatus=id=>api.post(`/lead-statuses/${id}/disable`);
export const deleteLeadStatus=id=>api.delete(`/lead-statuses/${id}`);
