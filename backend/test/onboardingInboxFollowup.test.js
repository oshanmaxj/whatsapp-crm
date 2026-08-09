const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('onboarding uses logical versioned dedupe and atomic creation', () => {
  const code = source('src/services/studentMessageAutomation.service.js');
  assert.match(code, /logicalOwner/);
  assert.match(code, /templateVersion/);
  assert.match(code, /findOrCreate/);
  assert.match(code, /whatsappMessageId/);
  assert.match(code, /manual_send_missing/);
});

test('message workers claim rows with transaction locking and skip locked', () => {
  const code = source('src/services/messageQueue.service.js');
  assert.match(code, /sequelize\.transaction/);
  assert.match(code, /LOCK\.UPDATE/);
  assert.match(code, /skipLocked:\s*true/);
});

test('credential messages require content, remain encrypted at rest and are redacted after acceptance', () => {
  const automation = source('src/services/studentMessageAutomation.service.js');
  const worker = source('src/services/messageQueue.service.js');
  const education = source('src/services/education.service.js');
  assert.match(automation, /temporary_credential_or_setup_link_required/);
  assert.match(automation, /encryptedText/);
  assert.match(worker, /credentialRedacted/);
  assert.doesNotMatch(education, /created\.generatedPortalPassword/);
  assert.match(education, /RESET LMS PASSWORD/);
});

test('inbox and message APIs use bounded signed cursor pagination', () => {
  const inbox = source('src/services/inbox.service.js');
  const chat = source('src/services/chat.service.js');
  assert.match(inbox, /createHmac\('sha256'/);
  assert.match(inbox, /Math\.min\(100/);
  assert.match(inbox, /COALESCE.*last_message_at/);
  assert.match(inbox, /nextCursor/);
  assert.match(inbox, /limit:\s*limit \+ 1/);
  assert.match(inbox, /const hasMore = pageRows\.length > limit/);
  assert.match(inbox, /filteredTotal/);
  assert.match(inbox, /unread_message\.is_read = false/);
  assert.match(inbox, /regexp_replace\(COALESCE/);
  assert.match(inbox, /Number\.isNaN\(timestamp\.getTime\(\)\)/);
  assert.doesNotMatch(inbox, /withInteractionRates\.filter\(\(item\) => item\.unreadCount/);
  assert.match(chat, /limit = Math\.min\(100/);
  assert.match(chat, /messages\.reverse/);
});

test('inbox cursor is generated from the last canonical SQL page row', () => {
  const inbox = source('src/services/inbox.service.js');
  assert.match(inbox, /const returnedPageRows = pageRows\.slice\(0, limit\)/);
  assert.match(inbox, /const cursorRow = returnedPageRows\[returnedPageRows\.length - 1\]/);
  assert.match(inbox, /encodeCursor\(\{ id: cursorRow\.id, lastMessageAt:/);
});

test('inbox category counters reuse the filtered permission scope', () => {
  const inbox = source('src/services/inbox.service.js');
  assert.match(inbox, /total: all\.filteredTotal/);
  assert.match(inbox, /inside: inside\.filteredTotal/);
  assert.match(inbox, /outside: outside\.filteredTotal/);
  assert.match(inbox, /closing: closing\.filteredTotal/);
});

test('pagination migration is bounded, locked and adds query-specific indexes', () => {
  const migration = source('migrations/061_onboarding_inbox_pagination.js');
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /lock_timeout/);
  assert.match(migration, /statement_timeout/);
  assert.match(migration, /conversations_cursor_idx/);
  assert.match(migration, /messages_conversation_history_idx/);
  assert.doesNotMatch(migration, /Model\.sync|TRUNCATE|DELETE FROM/i);
});
