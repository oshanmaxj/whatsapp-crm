import { INTERACTIVE_MEDIA_RULES, validateInteractiveDraft } from './interactiveMessageConfig';

const base = { body: 'Choose', headerType: 'none', buttons: [{ id: 'one', title: 'One' }] };

test('text-only interactive messages remain valid', () => {
  expect(validateInteractiveDraft(base)).toEqual({});
  expect(validateInteractiveDraft({ ...base, headerType: 'text', headerText: 'Header' })).toEqual({});
});

test('send remains blocked until media configuration is valid', () => {
  expect(validateInteractiveDraft({ ...base, headerType: 'image' }).header).toMatch(/select/i);
  expect(validateInteractiveDraft({ ...base, headerType: 'image', file: { type: 'image/gif', size: 100 } }).header).toMatch(/unsupported/i);
  expect(validateInteractiveDraft({ ...base, headerType: 'image', file: { type: 'image/jpeg', size: 0 } }).header).toMatch(/empty/i);
});

test('oversized interactive media is rejected client-side', () => {
  const errors = validateInteractiveDraft({ ...base, headerType: 'video', file: { type: 'video/mp4', size: INTERACTIVE_MEDIA_RULES.video.maxBytes + 1 } });
  expect(errors.header).toMatch(/exceeds/i);
});

test('valid image, video, and document media enable send', () => {
  for (const [type, mime] of [['image', 'image/png'], ['video', 'video/mp4'], ['document', 'application/pdf']]) {
    expect(validateInteractiveDraft({ ...base, headerType: type, file: { type: mime, size: 1024 } })).toEqual({});
  }
});
