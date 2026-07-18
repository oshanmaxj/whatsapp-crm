const mockRequestHandlers = [];
const mockResponseHandlers = [];
const mockApiClient = jest.fn((config) => Promise.resolve({ data: { retried: true }, config }));
mockApiClient.interceptors = {
  request: { use: jest.fn((handler) => mockRequestHandlers.push(handler)) },
  response: { use: jest.fn((success, failure) => mockResponseHandlers.push({ success, failure })) }
};
const mockRefreshClient = {
  post: jest.fn(),
  interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } }
};

jest.mock('axios', () => ({
  create: jest.fn()
    .mockImplementationOnce(() => mockRefreshClient)
    .mockImplementationOnce(() => mockApiClient)
}));

const {
  clearAuthState, logoutSession, refreshAccessToken, restoreAuthentication, storeAuthResponse, tokenIsUsable
} = require('./api');

function jwtWithExpiry(exp) {
  const encode = (value) => btoa(JSON.stringify(value)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${encode({ alg: 'none' })}.${encode({ exp })}.signature`;
}

beforeEach(() => {
  localStorage.clear();
  mockRefreshClient.post.mockReset();
  mockApiClient.mockClear();
});

test('persistent login restoration keeps a usable access token without refreshing', async () => {
  const token = jwtWithExpiry(Math.floor(Date.now() / 1000) + 300);
  localStorage.setItem('accessToken', token);
  expect(tokenIsUsable(token)).toBe(true);
  await expect(restoreAuthentication()).resolves.toBe(token);
  expect(mockRefreshClient.post).not.toHaveBeenCalled();
});

test('simultaneous expired requests share one refresh and retry independently', async () => {
  const token = jwtWithExpiry(Math.floor(Date.now() / 1000) + 300);
  let resolveRefresh;
  mockRefreshClient.post.mockReturnValue(new Promise((resolve) => { resolveRefresh = resolve; }));
  const first = refreshAccessToken();
  const second = refreshAccessToken();
  expect(mockRefreshClient.post).toHaveBeenCalledTimes(1);
  resolveRefresh({ data: { data: { tokens: { accessToken: token }, user: { id: 1 } } } });
  await expect(Promise.all([first, second])).resolves.toEqual([token, token]);

  mockRefreshClient.post.mockResolvedValue({ data: { data: { tokens: { accessToken: token } } } });
  localStorage.setItem('accessToken', 'expired');
  const failure = mockResponseHandlers[0].failure;
  const error = () => ({ response: { status: 401, data: { code: 'AUTH_EXPIRED' } }, config: { url: '/dashboard', headers: {} } });
  await Promise.all([failure(error()), failure(error())]);
  expect(mockApiClient).toHaveBeenCalledTimes(2);
});

test('refresh failure is definitive and explicit logout clears all local state', async () => {
  localStorage.setItem('accessToken', 'expired');
  localStorage.setItem('refreshToken', 'legacy');
  localStorage.setItem('user', '{}');
  mockRefreshClient.post.mockRejectedValueOnce(new Error('refresh failed'));
  await expect(restoreAuthentication()).rejects.toThrow('refresh failed');
  clearAuthState();
  expect(localStorage.getItem('accessToken')).toBeNull();

  localStorage.setItem('accessToken', 'token');
  mockRefreshClient.post.mockResolvedValueOnce({ data: { success: true } });
  await logoutSession();
  expect(mockRefreshClient.post).toHaveBeenCalledWith('/auth/logout', {});
  expect(localStorage.getItem('accessToken')).toBeNull();
});

test('authentication response stores only the access token, never a refresh token', () => {
  const token = jwtWithExpiry(Math.floor(Date.now() / 1000) + 300);
  storeAuthResponse({ data: { data: { user: { id: 2 }, tokens: { accessToken: token, refreshToken: 'must-not-persist' } } } });
  expect(localStorage.getItem('accessToken')).toBe(token);
  expect(localStorage.getItem('refreshToken')).toBeNull();
});
