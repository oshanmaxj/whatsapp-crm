const { Op } = require('sequelize');
const { Automation } = require('../models');
const automationService = require('./automation.service');
const logger = require('../config/logger');

// Finishes wiring the Automation model's existing scheduleType/scheduleValue/
// nextRunAt fields (see automation.service.js) — they were fully computed
// (calculateNextRun, ensureDefaults) but nothing ever polled them, so an
// automation's `enabled` flag alone never actually caused it to run; only a
// human clicking "Run now" did.
//
// INCIDENT (2026-09-22): the very first version of this file assumed that
// because NEW Automation rows default to enabled=false, starting this poller
// was a no-op until an admin explicitly opted in going forward. That missed
// an already-existing case: an admin can enable/disable an automation from
// the Automation Center at any time (toggleAutomation/updateAutomation),
// independent of this file ever existing — and every time that happens,
// nextRunAt is set to "the next occurrence from that moment". Since nothing
// ever polled nextRunAt before, an automation left enabled from a past
// admin action could carry a nextRunAt that is now long overdue. The first
// tick() then treated "overdue" as "due", and immediately executed
// automationService.execute() — e.g. FEE_REMINDER's sendBulkReminders(),
// which (a) had no cap on how many pending reminders it would send in one
// pass, and (b) never re-checked whether a reminder's installment had since
// been paid — producing a mass burst that included already-paid students.
// See feeReminder.service.js sendReminder() and sendBulkReminders() for the
// corresponding execution-side fixes; resyncOverdueSchedules() below is the
// scheduling-side fix: NOTHING is ever executed as part of starting or
// restarting this poller — an overdue schedule is only ever pushed forward
// to its next proper future occurrence, never run as a "catch-up".
let timer = null;
let starting = false;

async function tick() {
  const due = await Automation.findAll({
    where: { enabled: true, scheduleType: { [Op.ne]: 'manual' }, nextRunAt: { [Op.lte]: new Date() } }
  });
  for (const automation of due) {
    await automationService.runAutomation(automation.id).catch((error) => {
      logger.warn('automation_scheduler_run_failed', { automationId: automation.id, code: automation.code, error: error.message });
    });
  }
}

// Pushes any enabled, non-manual automation whose nextRunAt is missing or in
// the past forward to its next real future occurrence — WITHOUT ever calling
// runAutomation(). This runs once, synchronously, before the interval timer
// is armed, so a backend restart (or the scheduler being turned on for the
// first time, or re-enabled after being off) can never replay a backlog of
// historical/stale schedule state as an immediate mass execution.
async function resyncOverdueSchedules() {
  const stale = await Automation.findAll({
    where: { enabled: true, scheduleType: { [Op.ne]: 'manual' }, nextRunAt: { [Op.lte]: new Date() } }
  });
  for (const automation of stale) {
    const resyncedNextRunAt = automationService.calculateNextRunAt(automation.scheduleType, automation.scheduleValue, new Date());
    logger.warn('automation_scheduler_stale_schedule_resynced', {
      automationId: automation.id,
      code: automation.code,
      previousNextRunAt: automation.nextRunAt,
      resyncedNextRunAt
    });
    await automation.update({ nextRunAt: resyncedNextRunAt });
  }
  return stale.length;
}

async function start() {
  if (timer || starting) return;
  starting = true;
  try {
    await resyncOverdueSchedules();
  } catch (error) {
    logger.warn('automation_scheduler_resync_failed', { error: error.message });
  } finally {
    starting = false;
  }
  const interval = Math.max(60000, Number(process.env.AUTOMATION_SCHEDULER_INTERVAL_MS || 300000));
  timer = setInterval(() => {
    tick().catch((error) => logger.warn('automation_scheduler_tick_failed', { error: error.message }));
  }, interval);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
  starting = false;
}

module.exports = { start, stop, tick, resyncOverdueSchedules };
