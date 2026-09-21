const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Automation } = require('../src/models');
const automationSchedulerService = require('../src/services/automationScheduler.service');
const automationService = require('../src/services/automation.service');

const originals = {
  automationFindAll: Automation.findAll,
  runAutomation: automationService.runAutomation
};

test.afterEach(async () => {
  Automation.findAll = originals.automationFindAll;
  automationService.runAutomation = originals.runAutomation;
  await automationSchedulerService.stop();
});

function fakeAutomation(overrides = {}) {
  const row = { id: 1, code: 'FEE_REMINDER', scheduleType: 'daily', scheduleValue: '08:00', nextRunAt: new Date('2020-01-01'), ...overrides };
  row.update = async (fields) => { Object.assign(row, fields); return row; };
  return row;
}

// --- 1/2/3: scheduler default and explicit env behavior (source-level, since
// this is decided in server.js before any service code runs) ----------------

test('server.js only starts the automation scheduler on an explicit AUTOMATION_SCHEDULER_ENABLED==="true" — never merely "not false" (incident: it previously defaulted ON)', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'src/server.js'), 'utf8');
  assert.match(server, /process\.env\.AUTOMATION_SCHEDULER_ENABLED === 'true'/);
  assert.doesNotMatch(server, /AUTOMATION_SCHEDULER_ENABLED\s*!==\s*'false'/);
});

// --- 4: startup never replays historical/overdue schedules as an immediate
// execution — it only pushes them forward ------------------------------------

test('resyncOverdueSchedules() pushes an overdue schedule to its next future occurrence WITHOUT ever calling runAutomation (no backlog replay on startup)', async () => {
  const stale = fakeAutomation({ id: 7, code: 'FEE_REMINDER', nextRunAt: new Date('2020-01-01T00:00:00Z') });
  Automation.findAll = async () => [stale];
  let runCalled = false;
  automationService.runAutomation = async () => { runCalled = true; return {}; };

  const count = await automationSchedulerService.resyncOverdueSchedules();

  assert.equal(count, 1);
  assert.equal(runCalled, false, 'runAutomation must never be called during resync');
  assert.ok(stale.nextRunAt > new Date(), 'the stale schedule must be pushed into the future');
});

test('start() always resyncs stale schedules before the interval timer can ever fire — a schedule stale since before this process started can never be treated as due on the very first tick', async () => {
  const stale = fakeAutomation({ id: 8, code: 'FEE_REMINDER', nextRunAt: new Date('2019-06-01T00:00:00Z') });
  let findAllCalls = 0;
  Automation.findAll = async () => { findAllCalls += 1; return findAllCalls === 1 ? [stale] : []; };
  let runCalled = false;
  automationService.runAutomation = async () => { runCalled = true; return {}; };

  await automationSchedulerService.start();

  assert.equal(runCalled, false);
  assert.ok(stale.nextRunAt > new Date());
});

test('a schedule that is genuinely due right now (never overdue, never stale) resyncs to the SAME kind of near-term next occurrence, not pushed arbitrarily far out', async () => {
  const almostDue = fakeAutomation({ id: 9, code: 'BIRTHDAY_WISH', scheduleType: 'daily', scheduleValue: '09:00', nextRunAt: new Date(Date.now() - 1000) });
  Automation.findAll = async () => [almostDue];
  automationService.runAutomation = async () => ({});

  await automationSchedulerService.resyncOverdueSchedules();

  const hoursAhead = (almostDue.nextRunAt.getTime() - Date.now()) / 3600000;
  assert.ok(hoursAhead >= 0 && hoursAhead <= 24, 'a daily schedule resyncs to within the next 24h, not years out');
});
