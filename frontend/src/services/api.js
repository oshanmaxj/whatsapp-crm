import axios from 'axios';
import { API_BASE_URL } from '../config/apiConfig';

const api = axios.create({
  baseURL: API_BASE_URL
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  config.headers = config.headers || {};
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  const hasAuthorization = Boolean(
    config.headers.Authorization
    || config.headers.authorization
    || config.headers.get?.('Authorization')
  );
  console.info('API authentication', {
    tokenExists: Boolean(token),
    requestUrl: `${config.baseURL || ''}${config.url || ''}`,
    hasAuthorization
  });

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const message = error.response?.data?.message || error.message || 'Request failed';
    const requestUrl = `${error.config?.baseURL || ''}${error.config?.url || ''}`;

    console.error('API request failed', {
      requestUrl,
      status: status || 'NETWORK_ERROR',
      message
    });

    const authErrorCodes = ['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED'];
    const isAuthenticationFailure = status === 401
      && authErrorCodes.includes(error.response?.data?.code);

    if (isAuthenticationFailure) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');

      if (window.location.pathname !== '/login') {
        window.location.assign('/login');
      }
    }

    return Promise.reject(error);
  }
);

export default api;
