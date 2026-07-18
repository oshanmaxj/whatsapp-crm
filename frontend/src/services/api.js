import axios from 'axios';
import { API_BASE_URL } from '../config/apiConfig';

const isDevelopment = process.env.NODE_ENV === 'development';
const authFailureCodes = ['AUTH_REQUIRED', 'AUTH_INVALID', 'AUTH_EXPIRED'];

const refreshClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true });
const api = axios.create({ baseURL: API_BASE_URL, withCredentials: true });
let refreshPromise = null;

export function clearAuthState() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}

export function storeAuthResponse(response) {
  const data = response?.data?.data || response?.data || {};
  const accessToken = data.accessToken || data.token || data.tokens?.accessToken;
  if (!accessToken) throw new Error('Authentication response did not include an access token.');
  localStorage.setItem('accessToken', accessToken);
  localStorage.removeItem('refreshToken');
  if (data.user) localStorage.setItem('user', JSON.stringify(data.user));
  return accessToken;
}

export function tokenIsUsable(token, skewSeconds = 10) {
  try {
    const encoded = String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    return Number(payload.exp || 0) > Math.floor(Date.now() / 1000) + skewSeconds;
  } catch { return false; }
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    const legacyRefreshToken = localStorage.getItem('refreshToken');
    refreshPromise = refreshClient.post('/auth/refresh', legacyRefreshToken ? { refreshToken: legacyRefreshToken } : {})
      .then((response) => storeAuthResponse(response))
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function restoreAuthentication() {
  const token = localStorage.getItem('accessToken');
  if (tokenIsUsable(token)) return token;
  return refreshAccessToken();
}

export async function logoutSession() {
  try { await refreshClient.post('/auth/logout', {}); } finally { clearAuthState(); }
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  config.headers = config.headers || {};
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use((response) => response, async (error) => {
  const status = error.response?.status;
  const code = error.response?.data?.code;
  const original = error.config || {};
  const authFailure = status === 401 && authFailureCodes.includes(code);

  if (authFailure && !original._authRetry && !String(original.url || '').includes('/auth/refresh')) {
    original._authRetry = true;
    try {
      const token = await refreshAccessToken();
      original.headers = original.headers || {};
      original.headers.Authorization = `Bearer ${token}`;
      return api(original);
    } catch (refreshError) {
      clearAuthState();
      if (typeof window !== 'undefined' && window.location.pathname !== '/login') window.location.assign('/login');
      return Promise.reject(refreshError);
    }
  }

  if (isDevelopment) {
    console.error('API request failed', { requestUrl: `${original.baseURL || ''}${original.url || ''}`, status: status || 'NETWORK_ERROR', message: error.response?.data?.message || error.message });
  }
  return Promise.reject(error);
});

export default api;
