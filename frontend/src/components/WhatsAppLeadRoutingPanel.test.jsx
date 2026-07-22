import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(path.join(__dirname, 'WhatsAppLeadRoutingPanel.jsx'), 'utf8');

test('routing UI has searchable large-pool agent selection and workload context', () => {
  expect(source).toMatch(/Autocomplete multiple/);
  expect(source).toMatch(/getRoutingEligibleAgents\(accountId, search\)/);
  expect(source).toMatch(/openChats/);
  expect(source).toMatch(/assignedLeads/);
});

test('routing UI exposes strategies, pool controls and test result', () => {
  for (const strategy of ['least_open_chats','round_robin','least_assigned_leads','weighted','specific_agent','manual']) expect(source).toContain(strategy);
  expect(source).toMatch(/updateRoutingAgent/);
  expect(source).toMatch(/deleteRoutingAgent/);
  expect(source).toMatch(/Test Routing/);
  expect(source).toMatch(/excludedAgents/);
});

test('routing UI protects editing and testing with permissions', () => {
  expect(source).toContain("hasPermission('whatsapp_routing.view')");
  expect(source).toContain("hasPermission('whatsapp_routing.manage_agents')");
  expect(source).toContain("hasPermission('whatsapp_routing.test')");
});
