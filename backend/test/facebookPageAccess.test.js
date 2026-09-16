const test = require('node:test');
const assert = require('node:assert/strict');

const facebookPageAccessService = require('../src/services/facebookPageAccess.service');
const facebookPageService = require('../src/services/facebookPage.service');
const models = require('../src/models');

function fakeUser({ isSystemAdmin = false, allFacebookPages = true, roles = [], facebookPages = [] }) {
  return { id: 1, isSystemAdmin, allFacebookPages, roles, facebookPages };
}

async function withFakeUser(user, callback) {
  const original = models.User.findByPk;
  models.User.findByPk = async () => user;
  try {
    return await callback();
  } finally {
    models.User.findByPk = original;
  }
}

test('system admin has unrestricted Facebook Page access regardless of allFacebookPages', async () => {
  await withFakeUser(fakeUser({ isSystemAdmin: true, allFacebookPages: false, facebookPages: [] }), async () => {
    assert.equal(await facebookPageAccessService.accessibleIds(1), null);
    await assert.doesNotReject(facebookPageAccessService.assertAccess('999', 1));
  });
});

test('a user with a role named admin is treated as unrestricted', async () => {
  await withFakeUser(fakeUser({ isSystemAdmin: false, allFacebookPages: false, roles: [{ id: 9, name: 'Admin' }] }), async () => {
    assert.equal(await facebookPageAccessService.accessibleIds(1), null);
  });
});

test('a default (allFacebookPages true) user is unrestricted even with no explicit grants', async () => {
  await withFakeUser(fakeUser({ allFacebookPages: true, facebookPages: [] }), async () => {
    assert.equal(await facebookPageAccessService.accessibleIds(1), null);
  });
});

test('a restricted user only sees their explicitly granted Facebook Pages', async () => {
  await withFakeUser(fakeUser({ allFacebookPages: false, facebookPages: [{ id: 5 }, { id: 8 }] }), async () => {
    const ids = await facebookPageAccessService.accessibleIds(1);
    assert.deepEqual(ids.sort(), ['5', '8']);
  });
});

test('a restricted user is denied access to a Page outside their grant list (403)', async () => {
  await withFakeUser(fakeUser({ allFacebookPages: false, facebookPages: [{ id: 5 }] }), async () => {
    await assert.rejects(facebookPageAccessService.assertAccess('999', 1), (error) => error.status === 403);
    await assert.doesNotReject(facebookPageAccessService.assertAccess('5', 1));
  });
});

test('assertAccess requires a Page id (422)', async () => {
  await withFakeUser(fakeUser({ allFacebookPages: true }), async () => {
    await assert.rejects(facebookPageAccessService.assertAccess(null, 1), (error) => error.status === 422);
  });
});

test('whereForUser scopes queries to an empty result set for a restricted user with zero grants', async () => {
  await withFakeUser(fakeUser({ allFacebookPages: false, facebookPages: [] }), async () => {
    const where = await facebookPageAccessService.whereForUser(1, 'facebookPageId');
    assert.ok(where.facebookPageId, 'expected an explicit facebookPageId filter, not an unrestricted {}');
  });
});

test('whereForUser returns no filter ({}) for an unrestricted user', async () => {
  await withFakeUser(fakeUser({ allFacebookPages: true }), async () => {
    const where = await facebookPageAccessService.whereForUser(1, 'facebookPageId');
    assert.deepEqual(where, {});
  });
});

test('the Facebook Page access token is never present in a serialized page, only a boolean flag', () => {
  const row = {
    toJSON: () => ({
      id: 1, name: 'My Page', pageId: '1234567890',
      pageAccessTokenEncrypted: 'enc:aaaa:bbbb:cccc-this-must-never-leak',
      appId: '999', active: true, webhookSubscribed: false, sendEnabled: true
    }),
    pageAccessTokenEncrypted: 'enc:aaaa:bbbb:cccc-this-must-never-leak'
  };
  const serialized = facebookPageService.serialize(row);
  assert.equal(serialized.pageAccessTokenEncrypted, undefined);
  assert.equal(serialized.accessTokenConfigured, true);
  const output = JSON.stringify(serialized);
  assert.equal(output.includes('this-must-never-leak'), false);
});

test('encrypt/decrypt round-trips a Page access token without storing it in plaintext', () => {
  process.env.APP_SETTINGS_ENCRYPTION_KEY = 'a-sufficiently-long-test-encryption-key-value';
  const token = 'EAAGtokenvaluethatmustneverappearinplaintext';
  const encrypted = facebookPageService.encrypt(token);
  assert.equal(encrypted.startsWith('enc:'), true);
  assert.equal(encrypted.includes(token), false);
  assert.equal(facebookPageService.decrypt(encrypted), token);
});
