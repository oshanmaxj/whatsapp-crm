const fs = require('fs');
const path = require('path');

test('conversation list uses observer pagination and explicit loading states', () => {
  const source = fs.readFileSync(path.join(__dirname, 'ConversationList.jsx'), 'utf8');
  expect(source).toContain('IntersectionObserver');
  expect(source).toContain('Loading more…');
  expect(source).toContain('End of conversations');
  expect(source).toContain('Retry loading conversations');
});

test('chat page deduplicates cursor pages and resets through query-bound requests', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../pages/ChatPage.jsx'), 'utf8');
  expect(source).toContain('new Map');
  expect(source).toContain('nextCursor');
  expect(source).toContain('loadOlderMessages');
  expect(source).toContain('AbortController');
});

test('student profile header uses responsive grid without absolute positioning', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../pages/students/StudentProfilePage.jsx'), 'utf8');
  const header = source.slice(source.indexOf('<Paper elevation={0}'), source.indexOf('Welcome delivery:'));
  expect(header).toContain('<Grid container');
  expect(header).toContain("overflowWrap: 'anywhere'");
  expect(header).toContain('flexShrink: 0');
  expect(header).not.toContain("position: 'absolute'");
});
