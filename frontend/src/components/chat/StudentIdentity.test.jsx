const fs = require('fs');
const path = require('path');

test('inbox and chat header render canonical student enrollment metadata', () => {
  const list = fs.readFileSync(path.join(__dirname, 'ConversationList.jsx'), 'utf8');
  const chat = fs.readFileSync(path.join(__dirname, 'ChatArea.jsx'), 'utf8');
  expect(list).toContain('conversation.student.registrationNumber');
  expect(list).toContain('courseName');
  expect(list).toContain('batchName');
  expect(list).toContain('more`');
  expect(chat).toContain('Student details');
  expect(chat).toContain("hasPermission('students.view')");
  expect(chat).toContain('Open student profile');
});

test('live student events patch existing rows instead of appending duplicates', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../pages/ChatPage.jsx'), 'utf8');
  expect(page).toContain("socket.on('student.identity.updated'");
  expect(page).toContain("socket.on('student.enrollment.updated'");
  expect(page).toContain('safeArray(current).map(patchIdentity)');
});

test('mobile student details are collapsed, accessible and reset per conversation', () => {
  const chat = fs.readFileSync(path.join(__dirname, 'ChatArea.jsx'), 'utf8');
  expect(chat).toContain('function MobileStudentDetails');
  expect(chat).toContain('useState(false)');
  expect(chat).toContain('aria-expanded={expanded}');
  expect(chat).toContain('aria-controls={panelId}');
  expect(chat).toContain("component=\"button\"");
  expect(chat).toContain("'&:focus-visible'");
  expect(chat).toContain('key={conversation.id}');
  expect(chat).toContain('useEffect(() => setExpanded(false), [conversation.id])');
  expect(chat).toContain('safeArray(student?.enrollments).filter');
  expect(chat).toContain("item.status === 'active'");
});

test('desktop keeps its expanded student summary and non-students render neither version', () => {
  const chat = fs.readFileSync(path.join(__dirname, 'ChatArea.jsx'), 'utf8');
  expect(chat).toContain('conversation.student && mobile');
  expect(chat).toContain('conversation.student && !mobile');
  expect(chat).toContain("maxHeight: 'min(44vh, 360px)'");
  expect(chat).toContain("overflowWrap: 'anywhere'");
});
