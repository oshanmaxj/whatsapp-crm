import api from './api';

export const getSmsGatewaySettings = () => api.get('/settings/sms-gateway');
export const saveSmsGatewaySettings = (payload) => api.patch('/settings/sms-gateway', payload);
export const testSmsGatewayConnection = () => api.post('/settings/sms-gateway/test-connection');
export const getSmsGatewayMasks = () => api.get('/settings/sms-gateway/masks');
export const getSmsGatewayBalance = () => api.get('/settings/sms-gateway/balance');
export const sendTestSms = (payload) => api.post('/settings/sms-gateway/send-test', payload);
