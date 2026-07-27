import api from './api';
export const getCallCenterDashboard=(params={})=>api.get('/call-center/dashboard',{params});
export const startCall=(payload)=>api.post('/call-center/calls/start',payload);
export const completeCall=(id,payload)=>api.post(`/call-center/calls/${id}/complete`,payload);
export const logCall=(payload)=>api.post('/call-center/calls/log',payload);
export const getCallCenterOptions=(params={})=>api.get('/call-center/options',{params});
export const getCallQueue=()=>api.get('/call-center/queue');
export const getActiveCall=()=>api.get('/call-center/calls/active');
