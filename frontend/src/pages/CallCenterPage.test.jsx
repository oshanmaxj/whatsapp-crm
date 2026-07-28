import CallCenterPage,{normalizeAgentTab,resolveCallCenterMode} from './CallCenterPage';
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

test('effective permissions select a secure Call Center mode',()=>{
  expect(resolveCallCenterMode({isSystemAdmin:false,permissions:['call_center.agent_workspace']})).toBe('agent');
  expect(resolveCallCenterMode({isSystemAdmin:false,permissions:['call_center.supervisor_dashboard']})).toBe('supervisor');
  expect(resolveCallCenterMode({isSystemAdmin:true,permissions:[]})).toBe('supervisor');
  expect(normalizeAgentTab('supervisor')).toBe('queue');
  expect(normalizeAgentTab('live')).toBe('queue');
  expect(normalizeAgentTab('history')).toBe('history');
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

test('Find Leads reuses canonical label and WhatsApp selectors and persists IDs', () => {
  const source = require('fs').readFileSync(require('path').join(__dirname, 'CallCenterPage.jsx'), 'utf8');
  expect(source).toContain('LabelMultiSelect');
  expect(source).toContain('WhatsAppAccountSelect');
  expect(source).toContain("labelMode:'any'");
  expect(source).toContain("labelIds:[]");
  expect(source).toContain("Array.isArray(value)?value.join(',')");
  expect(source).not.toContain('WhatsApp account ID');
  expect(source).not.toContain('Agent ID');
});

test('canonical Leads and Call Center share source and course options', () => {
  const leadsSource = require('fs').readFileSync(require('path').join(__dirname, 'LeadsPage.jsx'), 'utf8');
  const callCenterSource = require('fs').readFileSync(require('path').join(__dirname, 'CallCenterPage.jsx'), 'utf8');
  expect(leadsSource).toContain('LEAD_COURSES');
  expect(leadsSource).toContain('LEAD_SOURCES');
  expect(callCenterSource).toContain('LEAD_COURSES');
  expect(callCenterSource).toContain('LEAD_SOURCES');
});
