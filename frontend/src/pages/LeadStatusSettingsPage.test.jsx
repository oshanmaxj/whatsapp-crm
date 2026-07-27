import LeadStatusSettingsPage from './LeadStatusSettingsPage';
import * as service from '../services/leadStatusAdmin.service';

test('lead status settings page and management API surface load', () => {
  expect(LeadStatusSettingsPage).toBeDefined();
  expect(service.listLeadStatuses).toBeDefined();
  expect(service.createLeadStatus).toBeDefined();
  expect(service.updateLeadStatus).toBeDefined();
  expect(service.disableLeadStatus).toBeDefined();
  expect(service.deleteLeadStatus).toBeDefined();
});
