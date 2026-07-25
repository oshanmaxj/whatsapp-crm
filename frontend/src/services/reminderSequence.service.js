import api from './api';
export const listSequences=params=>api.get('/reminder-sequences',{params});
export const getReminderDashboard=()=>api.get('/reminder-sequences/dashboard');
export const saveSequence=(id,payload)=>id?api.patch(`/reminder-sequences/${id}`,payload):api.post('/reminder-sequences',payload);
export const deleteSequence=id=>api.delete(`/reminder-sequences/${id}`);
export const listSubscriptions=params=>api.get('/reminder-sequences/subscriptions',{params});
export const listExecutions=params=>api.get('/reminder-sequences/executions',{params});
export const changeSubscription=(id,action)=>api.post(`/reminder-sequences/subscriptions/${id}/${action}`);
export const retryExecution=id=>api.post(`/reminder-sequences/executions/${id}/retry`);
