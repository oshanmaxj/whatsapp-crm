'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost';
process.env.DB_NAME = process.env.DB_NAME || 'test';
process.env.DB_USER = process.env.DB_USER || 'test';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'test';
process.env.APP_SETTINGS_ENCRYPTION_KEY = process.env.APP_SETTINGS_ENCRYPTION_KEY || 'unit-test-encryption-key-32-bytes!!';

const models = require('../src/models');
const audienceService = require('../src/services/smsCampaignAudience.service');
const { estimateSegments } = require('../src/utils/smsSegment');
const { interpolateTemplate } = require('../src/utils/templateInterpolation');
const { personalize } = require('../src/services/smsCampaign.service');

// ---------- Phone normalization + dedup (via the 'contacts' source) ----------
test('contacts source normalizes and deduplicates the same recipient across phone formats', async () => {
  models.Contact.findAll = async () => ([
    { id: 1, firstName: 'Kasun', lastName: 'Perera', phone: '0771234567', status: 'active' },
    { id: 2, firstName: 'K.', lastName: 'P.', phone: '+94771234567', status: 'active' }, // same canonical number, different Contact row
    { id: 3, firstName: 'Nimal', lastName: 'Silva', phone: '771234568', status: 'active' }
  ]);
  const result = await audienceService.resolve({ recipientSource: 'contacts', audienceConfig: {} });
  assert.equal(result.totalValid, 2, 'the two contacts sharing 0771234567/+94771234567 must collapse into one recipient');
  const dup = result.recipients.find((r) => r.phone === '94771234567');
  assert.ok(dup, 'canonical form 94771234567 must be the dedup key');
  assert.equal(dup.matchedEntities.length, 2, 'both contact ids must be preserved as matched entities');
  assert.equal(result.duplicatesRemoved, 1);
});

test('invalid phone numbers are excluded and reported, not silently dropped', async () => {
  models.Contact.findAll = async () => ([
    { id: 10, firstName: 'Valid', phone: '0771234567', status: 'active' },
    { id: 11, firstName: 'Landline', phone: '0112345678', status: 'active' }, // not a mobile number -> invalid for SMS
    { id: 12, firstName: 'Garbage', phone: 'not-a-number', status: 'active' }
  ]);
  const result = await audienceService.resolve({ recipientSource: 'contacts', audienceConfig: {} });
  assert.equal(result.totalValid, 1);
  assert.equal(result.totalInvalid, 2);
  assert.ok(result.invalid.some((entry) => entry.entityId === 11));
  assert.ok(result.invalid.some((entry) => entry.entityId === 12));
});

test('leads source dedupes two leads that share the same underlying contact/phone', async () => {
  const sharedContact = { id: 5, firstName: 'Shared', lastName: 'Contact', phone: '0771111111' };
  models.Lead.findAll = async () => ([
    { id: 100, contact: sharedContact },
    { id: 101, contact: sharedContact }
  ]);
  const result = await audienceService.resolve({ recipientSource: 'leads', audienceConfig: {} });
  assert.equal(result.totalValid, 1);
  const recipient = result.recipients[0];
  assert.equal(recipient.leadId, 100, 'the first-seen lead id is kept as the primary association');
  assert.equal(recipient.matchedEntities.length, 2, 'both lead ids must be preserved for diagnostics');
});

test('students source filters by course/batch/status and resolves student phones', async () => {
  models.Student.findAll = async (options) => {
    assert.deepEqual(options.where, { courseId: 7, status: 'active' });
    return [{ id: 200, name: 'Student One', phone: '0772222222', contactId: null, leadId: null }];
  };
  const result = await audienceService.resolve({ recipientSource: 'students', audienceConfig: { courseId: 7, status: 'active' } });
  assert.equal(result.totalValid, 1);
  assert.equal(result.recipients[0].studentId, 200);
});

test('course source requires a courseId and resolves all students in that course', async () => {
  await assert.rejects(
    () => audienceService.resolve({ recipientSource: 'course', audienceConfig: {} }),
    (error) => { assert.equal(error.code, 'VALIDATION_FAILED'); return true; }
  );
  models.Student.findAll = async (options) => {
    assert.deepEqual(options.where, { courseId: 9 });
    return [{ id: 300, name: 'Course Student', phone: '0773333333' }];
  };
  const result = await audienceService.resolve({ recipientSource: 'course', audienceConfig: { courseId: 9 } });
  assert.equal(result.totalValid, 1);
});

test('batch source requires a batchId and resolves all students in that batch', async () => {
  await assert.rejects(() => audienceService.resolve({ recipientSource: 'batch', audienceConfig: {} }));
  models.Student.findAll = async (options) => {
    assert.deepEqual(options.where, { batchId: 4 });
    return [{ id: 400, name: 'Batch Student', phone: '0774444444' }];
  };
  const result = await audienceService.resolve({ recipientSource: 'batch', audienceConfig: { batchId: 4 } });
  assert.equal(result.totalValid, 1);
});

test('manual source splits on newlines and commas and normalizes each number', async () => {
  const result = await audienceService.resolve({
    recipientSource: 'manual',
    audienceConfig: { phoneNumbers: '0771234567\n+94772345678, 0773456789\nnot-a-number' }
  });
  assert.equal(result.totalValid, 3);
  assert.equal(result.totalInvalid, 1);
  assert.ok(result.recipients.every((r) => /^94\d{9}$/.test(r.phone)));
});

test('manual source deduplicates entries that represent the same canonical number', async () => {
  const result = await audienceService.resolve({
    recipientSource: 'manual',
    audienceConfig: { phoneNumbers: '0771234567,+94771234567,771234567' }
  });
  assert.equal(result.totalValid, 1, 'all three formats represent the same recipient');
  assert.equal(result.duplicatesRemoved, 2);
});

test('unknown recipient source is rejected', async () => {
  await assert.rejects(
    () => audienceService.resolve({ recipientSource: 'not-a-real-source', audienceConfig: {} }),
    (error) => { assert.equal(error.status, 422); return true; }
  );
});

// ---------- Personalization ----------
test('interpolateTemplate leaves missing optional variables blank, not "undefined"', () => {
  assert.equal(interpolateTemplate('Hi {{name}}, course {{course}}', { name: 'Amal' }), 'Hi Amal, course ');
  assert.equal(interpolateTemplate('{{missing}}', {}), '');
});

test('personalize() resolves name/first_name/phone for a campaign recipient', () => {
  const message = 'Hi {{first_name}} ({{name}}), your number is {{phone}}. Batch: {{batch}}.';
  const rendered = personalize(message, { name: 'Kasun Perera', phone: '94771234567' });
  assert.equal(rendered, 'Hi Kasun (Kasun Perera), your number is 94771234567. Batch: .');
});

// ---------- Segment estimation ----------
test('estimateSegments: GSM-7 single segment for a short plain-ASCII message', () => {
  const result = estimateSegments('Your OTP is 123456');
  assert.equal(result.encoding, 'GSM-7');
  assert.equal(result.segments, 1);
});

test('estimateSegments: GSM-7 multi-segment beyond 160 characters uses 153/part', () => {
  const result = estimateSegments('A'.repeat(200));
  assert.equal(result.encoding, 'GSM-7');
  assert.equal(result.segments, 2);
  assert.equal(result.charsPerSegment, 153);
});

test('estimateSegments: Unicode (e.g. Sinhala) text is classified UCS-2 with a 70-char single-segment limit', () => {
  const result = estimateSegments('ආයුබෝවන්');
  assert.equal(result.encoding, 'UCS-2');
  assert.equal(result.segments, 1);
});

test('estimateSegments: Unicode text beyond 70 characters uses 67/part', () => {
  const result = estimateSegments('ආ'.repeat(75));
  assert.equal(result.encoding, 'UCS-2');
  assert.equal(result.segments, 2);
  assert.equal(result.charsPerSegment, 67);
});

test('estimateSegments: empty message is zero segments', () => {
  assert.deepEqual(estimateSegments(''), { encoding: 'GSM-7', characters: 0, segments: 0, charsPerSegment: 160 });
});
