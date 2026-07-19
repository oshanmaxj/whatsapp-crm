import api from './api';
import { flowMediaUploadError, uploadFlowMedia } from './flowBuilder.service';

jest.mock('./api', () => ({
  __esModule: true,
  default: { post: jest.fn() }
}));

beforeEach(() => api.post.mockReset());

test('flow media upload sends multipart rather than base64 JSON', async () => {
  api.post.mockResolvedValue({ data: { data: { mediaId: 'meta-1' } } });
  const progress = jest.fn();
  await uploadFlowMedia(22, {
    whatsappAccountId: 7,
    mediaType: 'image',
    fileName: 'header.jpg',
    mimeType: 'image/jpeg',
    dataBase64: btoa('jpeg')
  }, { onUploadProgress: progress });
  const [url, form, config] = api.post.mock.calls[0];
  expect(url).toBe('/flows/22/media');
  expect(form).toBeInstanceOf(FormData);
  expect(form.get('file').type).toBe('image/jpeg');
  expect(form.get('mediaType')).toBe('image');
  expect(form.get('whatsappAccountId')).toBe('7');
  expect(config.timeout).toBe(120000);
  expect(config.onUploadProgress).toBe(progress);
});

test('frontend displays backend JSON 413 message', () => {
  const message = flowMediaUploadError({ response: { status: 413, data: { error: 'FILE_TOO_LARGE', message: 'Video exceeds the 16 MB WhatsApp limit.' } } }, 'video');
  expect(message).toBe('Video exceeds the 16 MB WhatsApp limit.');
});

test('frontend distinguishes proxy rejection, Multer rejection, and timeout', () => {
  expect(flowMediaUploadError({ message: 'Network Error' }, 'video')).toMatch(/Nginx or an upstream proxy/i);
  expect(flowMediaUploadError({ response: { status: 413, data: '<html>413 Request Entity Too Large</html>' } }, 'video')).toMatch(/Nginx or an upstream proxy/i);
  expect(flowMediaUploadError({ code: 'ECONNABORTED', message: 'timeout of 120000ms exceeded' }, 'video')).toMatch(/timed out/i);
});
