import api from './api';

export const getUsers = () => api.get('/users');
export const createUser = (payload) => api.post('/users', payload);
export const updateUser = (id, payload) => api.patch(`/users/${id}`, payload);
export const deactivateUser = (id) => api.delete(`/users/${id}`);
export const resetUserPassword = (id, password) => api.post(`/users/${id}/reset-password`, { password });

export const getRoles = () => api.get('/roles');
export const createRole = (payload) => api.post('/roles', payload);
export const updateRole = (id, payload) => api.patch(`/roles/${id}`, payload);
export const getPermissions = () => api.get('/permissions');
export const setRolePermissions = (roleId, permissionIds) => api.put(`/roles/${roleId}/permissions`, { permissionIds });
