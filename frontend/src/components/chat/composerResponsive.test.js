import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(__dirname, 'ChatArea.jsx'), 'utf8');

test('mobile composer keeps attachment and voice controls at 44px', () => {
  expect(source).toContain("width: 44, height: 44");
  expect(source).toContain('aria-label="Attach media"');
  expect(source).toContain('aria-label="Record voice message"');
});

test('quick replies scroll independently from primary composer controls', () => {
  expect(source).toContain("overflowX: 'auto'");
  expect(source).toContain("flexWrap: { xs: 'wrap', sm: 'nowrap' }");
});
