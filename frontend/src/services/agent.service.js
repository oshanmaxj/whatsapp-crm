import api from './api';

export const getAgents = () => api.get('/agents');
export const getAgentPerformance = () => api.get('/agents/performance');

function agentPayload(formData) {
  const payload = {
    name: formData.name,
    email: formData.email,
    role: formData.role,
    status: formData.status
  };
  const phone = String(formData.phone || '').trim();
  if (phone) payload.phone = phone;
  return payload;
}

export const createAgent = (formData) => api.post('/users', agentPayload(formData));
export const updateAgent = (id, formData) => api.patch(`/users/${id}`, agentPayload(formData));
