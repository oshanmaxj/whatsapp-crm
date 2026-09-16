const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const crypto = require('node:crypto');

const facebookSettingsService = require('../src/services/facebookSettings.service');
const facebookSettingsController = require('../src/controllers/facebookSettings.controller');
const facebookWebhookController = require('../src/controllers/facebookWebhook.controller');
const requirePermission = require('../src/middleware/permission.middleware');
const auditService = require('../src/services/audit.service');
const models = require('../src/models');

function fakeAppSettingRow(initial = {}) {
  const row = { id: 1, value: { ...initial }, updatedBy: null };
  row.update = async (fields) => { Object.assign(row, fields); return row; };
  return row;
}

async function withAppSettingRow(row, callback) {
  const original = models.AppSetting.findOrCreate;
  models.AppSetting.findOrCreate = async () => [row, false];
  try {
    return await callback(row);
  } finally {
    models.AppSetting.findOrCreate = original;
  }
}

async function withEnv(vars, callback) {
  const originals = {};
  for (const key of Object.keys(vars)) { originals[key] = process.env[key]; process.env[key] = vars[key]; }
  try {
    return await callback();
  } finally {
    for (const key of Object.keys(vars)) {
      if (originals[key] === undefined) delete process.env[key]; else process.env[key] = originals[key];
    }
  }
}

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.send = (body) => { res.body = body; return res; };
  return res;
}

test('an admin can retrieve Facebook configuration metadata', async () => {
  await withAppSettingRow(fakeAppSettingRow({ appId: '12345' }), async () => {
    const res = fakeRes();
    await facebookSettingsController.get({ user: { id: 1 } }, res, () => {});
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.data.appId, '12345');
    assert.equal(typeof res.body.data.appSecretConfigured, 'boolean');
    assert.equal(typeof res.body.data.webhookVerifyTokenConfigured, 'boolean');
    assert.equal(res.body.data.callbackUrl, 'https://api.firstofsolutions.com/api/webhooks/facebook');
  });
});

test('the actual App Secret is never returned by GET, only a configured flag', async () => {
  await withAppSettingRow(fakeAppSettingRow(), async () => {
    await facebookSettingsService.save({ appSecret: 'super-secret-value-12345' }, 7);
    const metadata = await facebookSettingsService.getPublicMetadata();
    assert.equal(metadata.appSecretConfigured, true);
    assert.equal('appSecret' in metadata, false);
    assert.equal(JSON.stringify(metadata).includes('super-secret-value-12345'), false);
  });
});

test('the actual stored Verify Token is never returned by GET after a normal reload', async () => {
  await withAppSettingRow(fakeAppSettingRow(), async () => {
    await facebookSettingsService.save({ webhookVerifyToken: 'my-verify-token-abcdef' }, 7);
    const metadata = await facebookSettingsService.getPublicMetadata();
    assert.equal(metadata.webhookVerifyTokenConfigured, true);
    assert.equal('webhookVerifyToken' in metadata, false);
    assert.equal(JSON.stringify(metadata).includes('my-verify-token-abcdef'), false);
  });
});

test('an unauthorized user (missing settings.edit) is rejected with 403 by the permission middleware', () => {
  const middleware = requirePermission('settings.edit');
  const res = fakeRes();
  let nextCalled = false;
  middleware({ user: { id: 5, isSystemAdmin: false, permissions: ['contacts.view'] } }, res, () => { nextCalled = true; });
  assert.equal(res.statusCode, 403);
  assert.equal(nextCalled, false);
});

test('a system admin is always allowed through regardless of the permissions array', () => {
  const middleware = requirePermission('settings.edit');
  const res = fakeRes();
  let nextCalled = false;
  middleware({ user: { id: 1, isSystemAdmin: true, permissions: [] } }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('the Facebook settings routes are gated by settings.view / settings.edit, not left open', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/routes/facebookSettings.routes.js'), 'utf8');
  assert.match(source, /auth\.authenticate/);
  assert.match(source, /requirePermission\('settings\.view'\)/);
  assert.match(source, /requirePermission\('settings\.edit'\).*controller\.save/);
  assert.match(source, /requirePermission\('settings\.edit'\).*controller\.generateVerifyToken/);
  assert.match(source, /requirePermission\('settings\.edit'\).*controller\.test/);
});

test('saving the App ID works', async () => {
  await withAppSettingRow(fakeAppSettingRow(), async () => {
    await facebookSettingsService.save({ appId: '999888777' }, 1);
    const metadata = await facebookSettingsService.getPublicMetadata();
    assert.equal(metadata.appId, '999888777');
  });
});

test('saving and later replacing the App Secret both work', async () => {
  await withAppSettingRow(fakeAppSettingRow(), async () => {
    await facebookSettingsService.save({ appSecret: 'first-secret' }, 1);
    assert.equal((await facebookSettingsService.getRuntimeConfig()).appSecret, 'first-secret');
    await facebookSettingsService.save({ appSecret: 'second-secret' }, 1);
    assert.equal((await facebookSettingsService.getRuntimeConfig()).appSecret, 'second-secret');
  });
});

test('a blank App Secret on save does not erase the existing secret', async () => {
  await withAppSettingRow(fakeAppSettingRow(), async () => {
    await facebookSettingsService.save({ appSecret: 'keep-this-secret' }, 1);
    await facebookSettingsService.save({ appId: 'unrelated-change', appSecret: '' }, 1);
    assert.equal((await facebookSettingsService.getRuntimeConfig()).appSecret, 'keep-this-secret');
    const metadata = await facebookSettingsService.getPublicMetadata();
    assert.equal(metadata.appSecretConfigured, true);
  });
});

test('verify token generation uses crypto.randomBytes, not Math.random, and produces distinct high-entropy tokens', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src/services/facebookSettings.service.js'), 'utf8');
  assert.match(source, /crypto\.randomBytes\(32\)/);
  assert.equal(/Math\.random/.test(source), false);

  await withAppSettingRow(fakeAppSettingRow(), async () => {
    const first = await facebookSettingsService.generateVerifyToken(1);
    const second = await facebookSettingsService.generateVerifyToken(1);
    assert.match(first.verifyToken, /^[0-9a-f]{64}$/);
    assert.match(second.verifyToken, /^[0-9a-f]{64}$/);
    assert.notEqual(first.verifyToken, second.verifyToken);
    assert.equal(first.webhookVerifyTokenConfigured, true);
  });
});

test('a generated verify token is retrievable only once — GET never returns it again', async () => {
  await withAppSettingRow(fakeAppSettingRow(), async () => {
    const generated = await facebookSettingsService.generateVerifyToken(1);
    const metadata = await facebookSettingsService.getPublicMetadata();
    assert.equal(JSON.stringify(metadata).includes(generated.verifyToken), false);
    assert.equal(metadata.webhookVerifyTokenConfigured, true);
  });
});

test('environment variables act as a fallback only when nothing is configured in settings, and settings take precedence once saved', async () => {
  await withAppSettingRow(fakeAppSettingRow(), async () => {
    await withEnv({ FACEBOOK_APP_SECRET: 'env-secret-value' }, async () => {
      const beforeSave = await facebookSettingsService.getRuntimeConfig();
      assert.equal(beforeSave.appSecret, 'env-secret-value');
      assert.equal(beforeSave.appSecretSource, 'env');

      await facebookSettingsService.save({ appSecret: 'settings-secret-value' }, 1);
      const afterSave = await facebookSettingsService.getRuntimeConfig();
      assert.equal(afterSave.appSecret, 'settings-secret-value');
      assert.equal(afterSave.appSecretSource, 'settings');
    });
  });
});

test('audit metadata for settings updates and token generation never contains the secret/token values', async () => {
  const originalRecord = auditService.record;
  const recorded = [];
  auditService.record = async (entry) => { recorded.push(entry); return null; };
  try {
    await withAppSettingRow(fakeAppSettingRow(), async () => {
      await facebookSettingsService.save({ appId: 'abc', appSecret: 'top-secret-audit-check' }, 3);
      await facebookSettingsService.generateVerifyToken(3);
    });
  } finally {
    auditService.record = originalRecord;
  }
  const actions = recorded.map((entry) => entry.action);
  assert.ok(actions.includes('facebook_settings_updated'));
  assert.ok(actions.includes('facebook_app_secret_replaced'));
  assert.ok(actions.includes('facebook_verify_token_generated'));
  const serialized = JSON.stringify(recorded);
  assert.equal(serialized.includes('top-secret-audit-check'), false);
  for (const entry of recorded) {
    assert.equal(typeof entry.changes.appSecretChanged === 'boolean' || entry.changes.appSecretChanged === undefined, true);
  }
});

test('end-to-end: GET webhook verification succeeds using a verify token configured through the settings API (no env var involved)', async () => {
  await withAppSettingRow(fakeAppSettingRow(), async () => {
    await withEnv({ FACEBOOK_WEBHOOK_VERIFY_TOKEN: '' }, async () => {
      await facebookSettingsService.generateVerifyToken(1);
      const { verifyToken } = await facebookSettingsService.generateVerifyToken(1); // second generation is the one we'll actually use
      const res = fakeRes();
      await facebookWebhookController.verifyWebhook({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': verifyToken, 'hub.challenge': 'REAL_CHALLENGE' } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body, 'REAL_CHALLENGE');
    });
  });
});

test('end-to-end: an invalid verify token is rejected even when a valid one is configured in settings', async () => {
  await withAppSettingRow(fakeAppSettingRow(), async () => {
    await facebookSettingsService.generateVerifyToken(1);
    const res = fakeRes();
    await facebookWebhookController.verifyWebhook({ query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'definitely-wrong', 'hub.challenge': 'X' } }, res);
    assert.equal(res.statusCode, 403);
  });
});

test('end-to-end: POST webhook signature validation uses the App Secret configured through the settings API', async () => {
  await withAppSettingRow(fakeAppSettingRow(), async () => {
    await facebookSettingsService.save({ appSecret: 'db-configured-app-secret' }, 1);

    const originalFindOne = models.FacebookPage.findOne;
    const originalWeCreate = models.FacebookWebhookEvent.create;
    models.FacebookPage.findOne = async () => null; // unknown page is fine — we only care that signature validation runs first
    models.FacebookWebhookEvent.create = async () => ({});
    try {
      const body = { object: 'page', entry: [] };
      const rawBody = Buffer.from(JSON.stringify(body));
      const validSignature = `sha256=${crypto.createHmac('sha256', 'db-configured-app-secret').update(rawBody).digest('hex')}`;

      const okRes = fakeRes();
      await facebookWebhookController.processWebhook({ body, rawBody, headers: { 'x-hub-signature-256': validSignature } }, okRes);
      assert.equal(okRes.statusCode, 200);

      const badRes = fakeRes();
      await facebookWebhookController.processWebhook({ body, rawBody, headers: { 'x-hub-signature-256': 'sha256=0000000000000000000000000000000000000000000000000000000000000000' } }, badRes);
      assert.equal(badRes.statusCode, 401);
    } finally {
      models.FacebookPage.findOne = originalFindOne;
      models.FacebookWebhookEvent.create = originalWeCreate;
    }
  });
});

test('testConfiguration reports checks without ever exposing the credentials', async () => {
  await withAppSettingRow(fakeAppSettingRow(), async () => {
    await facebookSettingsService.save({ appId: 'app-1', appSecret: 'super-secret-for-test' }, 1);
    // Avoid a real network call to Meta in this sandbox.
    const originalGet = require('axios').get;
    require('axios').get = async () => { throw new Error('network disabled in test'); };
    try {
      const result = await facebookSettingsService.testConfiguration();
      assert.equal(result.checks.appId, true);
      assert.equal(result.checks.appSecret, true);
      assert.equal(result.checks.webhookEndpoint, true);
      assert.equal(JSON.stringify(result).includes('super-secret-for-test'), false);
    } finally {
      require('axios').get = originalGet;
    }
  });
});
