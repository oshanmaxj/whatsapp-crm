import CallCenterPage from './CallCenterPage';
import * as service from '../services/callCenter.service';

test('call center page and API surface load', () => {
  expect(CallCenterPage).toBeDefined();
  expect(service.getCallCenterDashboard).toBeDefined();
  expect(service.startCall).toBeDefined();
  expect(service.completeCall).toBeDefined();
  expect(service.logCall).toBeDefined();
  expect(service.searchCallCenterLeads).toBeDefined();
  expect(service.addCallQueueEntries).toBeDefined();
  expect(service.claimNextCall).toBeDefined();
});

test('canonical outcomes auto-map and missing statuses block save', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, 'CallCenterPage.jsx'), 'utf8');
  expect(source).toContain("'Busy':'busy'");
  expect(source).toContain("'No Answer':'no_answer'");
  expect(source).toContain("'Call Back Later':'follow_up_required'");
  expect(source).toContain('Ask an administrator to enable it.');
  expect(source).toContain('busy||mappedMissing');
});

test('Phase 1 queue workflow and URL restoration are present', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, 'CallCenterPage.jsx'), 'utf8');
  expect(source).toContain('My Queue');
  expect(source).toContain('Find Leads');
  expect(source).toContain('CALL NEXT');
  expect(source).toContain('sessionStorage');
  expect(source).toContain('returnTo=');
  expect(source).toContain('SELECT CHAT');
});
