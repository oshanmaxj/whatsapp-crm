import fs from 'fs';
import path from 'path';

test('broadcast wizard requires and previews approved template header media', () => {
  const source = fs.readFileSync(path.join(__dirname, 'CampaignsPage.jsx'), 'utf8');
  expect(source).toMatch(/Header \$\{selectedTemplate\.headerType/);
  expect(source).toMatch(/header media is required/);
  expect(source).toMatch(/Selected header preview/);
  expect(source).toMatch(/uploadCampaignHeaderMedia/);
  expect(source).toMatch(/Template sample media is not used for delivery/);
});
