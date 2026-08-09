import api from './api';
export const listSupportTickets=(params={})=>api.get('/support-tickets',{params});
export const getSupportTicket=(id)=>api.get(`/support-tickets/${id}`);
export const getSupportTicketDashboard=()=>api.get('/support-tickets/dashboard');
export const listSupportCategories=()=>api.get('/support-tickets/categories');
export const replySupportTicket=(id,body)=>api.post(`/support-tickets/${id}/replies`,{body});
export const addSupportInternalNote=(id,body)=>api.post(`/support-tickets/${id}/internal-notes`,{body});
export const transitionSupportTicket=(id,status,payload={})=>api.post(`/support-tickets/${id}/status`,{status,...payload});
export const assignSupportTicket=(id,payload)=>api.post(`/support-tickets/${id}/assign`,payload);
