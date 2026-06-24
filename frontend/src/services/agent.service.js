import api from './api';

export const getAgents = () => api.get('/agents');
export const getAgentPerformance = () => api.get('/agents/performance');
