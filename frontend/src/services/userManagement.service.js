import api from './api';

export const getUsers = () => api.get('/users');

function userPayload(formData, { includePassword = false } = {}) {
  const payload = {
    name: String(formData.name || '').trim(),
    email: String(formData.email || '').trim(),
    roleId: Number(formData.roleId),
    status: formData.status || 'active',
    receiveAssignmentNotifications: formData.receiveAssignmentNotifications !== false
  };
  const phone = String(formData.phone || '').trim();
  if (phone) payload.phone = phone;
  if (includePassword) payload.password = formData.password;
  return payload;
}

export const createUser = (formData) => api.post('/users', userPayload(formData, { includePassword: true }));
export const updateUser = (id, formData) => api.patch(`/users/${id}`, userPayload(formData));
export const deactivateUser = (id) => api.delete(`/users/${id}`);
export const resetUserPassword = (id, password) => api.post(`/users/${id}/reset-password`, { password });

export const getRoles = (includeInactive = false) => api.get('/roles', { params: includeInactive ? { includeInactive: true } : {} });
export const createRole = (payload) => api.post('/roles', payload);
export const updateRole = (id, payload) => api.patch(`/roles/${id}`, payload);
export const deactivateRole = (id) => api.patch(`/roles/${id}/deactivate`);
export const getPermissions = () => api.get('/permissions');
export const setRolePermissions = (roleId, permissionIds) => api.put(`/roles/${roleId}/permissions`, { permissionIds });
export const getUserPermissions = (id) => api.get(`/users/${id}/permissions`);
export const setUserPermissions = (id, overrides) => api.put(`/users/${id}/permissions`, { overrides });
