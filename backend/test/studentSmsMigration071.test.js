const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('migration 071 is bounded, advisory-locked with its own distinct lock id, and idempotent', () => {
  const migration = source('migrations/071_student_sms_notifications.js');
  assert.match(migration, /const LOCK = 570071/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /lock_timeout/);
  assert.match(migration, /statement_timeout/);
  assert.doesNotMatch(migration, /TRUNCATE|DELETE FROM|DROP TABLE/i);
});

test('migration 071 does not reuse migration 070\'s lock id (570070) or any other known lock id', () => {
  const migration = source('migrations/071_student_sms_notifications.js');
  assert.doesNotMatch(migration, /570070\b/);
  assert.doesNotMatch(migration, /570069\b/);
});

test('migration 071 adds the two new columns guarded by addColumnIfMissing/addIndexIfMissing (safe to re-run)', () => {
  const migration = source('migrations/071_student_sms_notifications.js');
  assert.match(migration, /addColumnIfMissing\(q, 'sms_messages', 'dedupe_key'/);
  assert.match(migration, /addIndexIfMissing\(q, 'sms_messages', \['dedupe_key'\], \{ name: 'sms_messages_dedupe_key_uq', unique: true \}/);
  assert.match(migration, /addColumnIfMissing\(q, 'students', 'class_sms_reminders_enabled'/);
  assert.match(migration, /defaultValue: true/);
});

test('migration 071 seeds the 4 SMS templates with ON CONFLICT (key) DO NOTHING, channel sms, so re-running never overwrites admin edits', () => {
  const migration = source('migrations/071_student_sms_notifications.js');
  assert.match(migration, /ON CONFLICT \(key\) DO NOTHING/);
  for (const key of ['student_welcome_sms', 'class_reminder_sms', 'birthday_wish_sms', 'payment_reminder_sms']) {
    assert.match(migration, new RegExp(key));
  }
});

test('migration 071 seeds the class-sms-reminders permission and grants it to admin roles only', () => {
  const migration = source('migrations/071_student_sms_notifications.js');
  assert.match(migration, /student\.class_sms_reminders\.manage/);
  assert.match(migration, /LOWER\(r\.name\) IN \('admin','administrator','system administrator'\)/);
});

test('the run_migrations.js runner registers migration 071 after 070', () => {
  const runner = source('src/scripts/run_migrations.js');
  const idx070 = runner.indexOf("070_facebook_comment_auto_hide.js");
  const idx071 = runner.indexOf("071_student_sms_notifications.js");
  assert.ok(idx070 > -1 && idx071 > -1);
  assert.ok(idx071 > idx070, 'migration 071 should run after 070');
});

test('the welcome SMS template never embeds portal credentials (SMS is not a secure credential channel)', () => {
  const migration = source('migrations/071_student_sms_notifications.js');
  const welcomeTemplateSection = migration.slice(migration.indexOf("key: 'student_welcome_sms'"), migration.indexOf("key: 'class_reminder_sms'"));
  assert.doesNotMatch(welcomeTemplateSection, /portal_password/);
});
