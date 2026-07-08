const trimTrailingSlash = (value) => String(value || '').replace(/\/+$/, '');

export const API_BASE_URL = trimTrailingSlash(process.env.REACT_APP_API_URL || '/api');
export const SOCKET_URL = trimTrailingSlash(process.env.REACT_APP_SOCKET_URL || window.location.origin);
export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

export function apiUrl(path = '') {
  const normalizedPath = String(path).startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
}
