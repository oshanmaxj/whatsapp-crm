import CallCenterPage from './CallCenterPage';
import * as service from '../services/callCenter.service';

test('call center page and API surface load', () => {
  expect(CallCenterPage).toBeDefined();
  expect(service.getCallCenterDashboard).toBeDefined();
  expect(service.startCall).toBeDefined();
  expect(service.completeCall).toBeDefined();
  expect(service.logCall).toBeDefined();
});
