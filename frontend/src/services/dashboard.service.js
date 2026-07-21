import api from './api';

export const getDashboardSummary = () => api.get('/dashboard/summary');
export const getAgentLeaderboard = (params = {}) => api.get('/dashboard/leaderboard', { params });
