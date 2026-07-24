import api from '../../services/api';
import {
  acquireAuthenticatedMedia,
  clearAuthenticatedMediaCache,
  releaseAuthenticatedMedia
} from './AuthenticatedMedia';

jest.mock('../../services/api', () => ({ __esModule: true, default: { get: jest.fn() } }));

beforeEach(() => {
  jest.useFakeTimers();
  clearAuthenticatedMediaCache();
  api.get.mockReset();
  URL.createObjectURL = jest.fn(() => 'blob:authenticated-media');
  URL.revokeObjectURL = jest.fn();
});

afterEach(() => {
  clearAuthenticatedMediaCache();
  jest.useRealTimers();
});

test('authenticated media uses one blob request for concurrent normal and flow renderers', async () => {
  api.get.mockResolvedValue({
    status: 200,
    headers: { 'content-type': 'image/jpeg' },
    data: new Blob(['image'], { type: 'image/jpeg' })
  });
  const source = '/api/media/50/download';
  const [first, second] = await Promise.all([
    acquireAuthenticatedMedia(source),
    acquireAuthenticatedMedia(source)
  ]);
  expect(first).toBe('blob:authenticated-media');
  expect(second).toBe(first);
  expect(api.get).toHaveBeenCalledTimes(1);
  expect(api.get).toHaveBeenCalledWith('/media/50/download', { responseType: 'blob' });
  releaseAuthenticatedMedia(source);
  releaseAuthenticatedMedia(source);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  jest.advanceTimersByTime(30000);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(first);
});

test('authenticated media rejects JSON error bodies and permits a bounded manual retry', async () => {
  api.get
    .mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'application/json' },
      data: new Blob(['{}'], { type: 'application/json' })
    })
    .mockResolvedValueOnce({
      status: 200,
      headers: { 'content-type': 'audio/mpeg' },
      data: new Blob(['audio'], { type: 'audio/mpeg' })
    });
  const source = '/api/media/51/download';
  await expect(acquireAuthenticatedMedia(source)).rejects.toThrow('binary content');
  await expect(acquireAuthenticatedMedia(source, { reload: true })).resolves.toBe('blob:authenticated-media');
  expect(api.get).toHaveBeenCalledTimes(2);
  releaseAuthenticatedMedia(source);
});
