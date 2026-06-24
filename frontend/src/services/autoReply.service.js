import api from './api';

const BASE_ROUTE = '/auto-replies';

export const getAutoReplies = () => api.get(BASE_ROUTE);
export const createAutoReply = (payload) => api.post(BASE_ROUTE, payload);
export const updateAutoReply = (id, payload) => api.patch(`${BASE_ROUTE}/${id}`, payload);
export const deleteAutoReply = (id) => api.delete(`${BASE_ROUTE}/${id}`);
