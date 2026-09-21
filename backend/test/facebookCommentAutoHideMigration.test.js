const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('facebook comment auto-hide migration is bounded, advisory-locked, and idempotent', () => {
  const migration = source('migrations/070_facebook_comment_auto_hide.js');
  assert.match(migration, /const LOCK = 570070/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /lock_timeout/);
  assert.match(migration, /statement_timeout/);
  assert.match(migration, /tableExists\(q, 'facebook_comment_auto_hide_rules'/);
  assert.match(migration, /addColumnIfMissing\(q, 'facebook_comments', 'auto_hide_status'/);
  assert.match(migration, /addIndexIfMissing/);
  assert.doesNotMatch(migration, /TRUNCATE|DELETE FROM|DROP TABLE/i);
});

test('the migration seeds auto-hide as an additive, disabled-by-default feature (no app_settings write, no ON CONFLICT gamble on an unmanaged unique index)', () => {
  const migration = source('migrations/070_facebook_comment_auto_hide.js');
  assert.doesNotMatch(migration, /INSERT INTO app_settings/);
  assert.match(migration, /findOrCreate/); // documented in the migration's own comment, enforced in the settings service
});

test('the migration is wired into the production migration runner', () => {
  const runner = source('src/scripts/run_migrations.js');
  assert.match(runner, /require\('..\/..\/migrations\/070_facebook_comment_auto_hide'\)/);
  assert.match(runner, /runMigration\('070_facebook_comment_auto_hide\.js', facebookCommentAutoHideMigration, queryInterface\)/);
});

test('the settings service seeds the global auto-hide flag as OFF by default (safe rollout)', () => {
  const service = source('src/services/facebookCommentAutoHideRule.service.js');
  assert.match(service, /enabled:\s*false/);
});
