const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('student canonical names preserve Unicode and collapse whitespace', () => {
  const { normalizeStudentName } = require('../src/services/studentCanonicalIdentity.service');
  assert.equal(normalizeStudentName('  නලින්   කුමාර  '), 'නලින් කුමාර');
  assert.throws(() => normalizeStudentName('Recipient'), /valid registered student name/);
  assert.throws(() => normalizeStudentName('+94 77 123 4567'), /valid registered student name/);
});

test('registration synchronizes the explicit contact inside the student transaction', () => {
  const education = source('src/services/education.service.js');
  assert.match(education, /studentCanonicalIdentityService\.sync/);
  assert.match(education, /contactId: contact\.id/);
  assert.match(education, /actorUserId: userId, transaction/);
  assert.match(education, /normalizeStudentName\(next\.name\)/);
});

test('identity resolution prefers explicit links and refuses ambiguous phone candidates', () => {
  const identity = source('src/services/studentCanonicalIdentity.service.js');
  assert.match(identity, /const explicitId = contactId \|\| student\?\.contactId/);
  assert.match(identity, /STUDENT_CONTACT_IDENTITY_AMBIGUOUS/);
  assert.match(identity, /whatsappAccountId \? \{ whatsappAccountId \}/);
  assert.doesNotMatch(identity, /merge|destroy\(/i);
});

test('inbox student summaries are batched and searchable by enrollment data', () => {
  const inbox = source('src/services/inbox.service.js');
  assert.match(inbox, /attachStudentSummaries/);
  assert.match(inbox, /Student\.findAll/);
  assert.match(inbox, /search_student\.student_no/);
  assert.match(inbox, /search_course\.name/);
  assert.match(inbox, /search_batch\.code/);
  assert.match(inbox, /registeredStudentsOnly/);
});

test('repair command is dry-run by default and writes only with --apply', () => {
  const repair = source('src/scripts/repair_student_contact_identity.js');
  assert.match(repair, /process\.argv\.includes\('--apply'\)/);
  assert.match(repair, /mode: apply \? 'apply' : 'dry-run'/);
  assert.match(repair, /if \(apply\)/);
});
