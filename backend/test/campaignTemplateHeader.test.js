const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { templateComponents } = require('../src/services/campaign.service');
const { campaignFailure } = require('../src/services/messageQueue.service');

test('IMAGE template produces the exact Meta header image parameter', () => {
  const components = templateComponents(
    { headerType: 'IMAGE', headerContent: null },
    { variables: {}, headerMedia: { mediaId: '123' } },
    {},
    { type: 'image', image: { id: '123' } }
  );
  assert.deepEqual(components[0], {
    type: 'header',
    parameters: [{ type: 'image', image: { id: '123' } }]
  });
});

test('media template without a valid delivery header is rejected before queueing', () => {
  assert.throws(
    () => templateComponents({ headerType: 'IMAGE' }, { variables: {} }, {}, null),
    error => error.code === 'CAMPAIGN_TEMPLATE_HEADER_REQUIRED' && error.status === 422
  );
});

test('TEXT variable headers use a text parameter and NONE omits the header', () => {
  const text = templateComponents(
    { headerType: 'TEXT', headerContent: 'Hello {{1}}' },
    { variables: {}, headerText: 'Student' },
    {}
  );
  assert.deepEqual(text[0], { type: 'header', parameters: [{ type: 'text', text: 'Student' }] });
  assert.deepEqual(templateComponents({ headerType: 'NONE' }, { variables: {} }, {}), []);
});

test('Meta 132012 is permanent and receives a safe campaign message', () => {
  const result = campaignFailure({
    response: { status: 400, data: { error: { code: 132012, message: 'unsafe provider detail' } } }
  });
  assert.equal(result.permanent, true);
  assert.equal(result.message, 'Template requires an image header, but no valid image was provided.');
});

test('campaign completion and migration support terminal partial failures', () => {
  const queueSource = fs.readFileSync(path.join(__dirname, '../src/services/messageQueue.service.js'), 'utf8');
  const migrationSource = fs.readFileSync(path.join(__dirname, '../migrations/047_campaign_template_headers.js'), 'utf8');
  assert.match(queueSource, /Completed with failures/);
  assert.match(migrationSource, /header_media/);
  assert.match(migrationSource, /ADD VALUE IF NOT EXISTS 'Completed with failures'/);
});
