const { Op } = require('sequelize');
const { Automation } = require('../models');
const automationService = require('./automation.service');
const logger = require('../config/logger');

// Finishes wiring the Automation model's existing scheduleType/scheduleValue/
// nextRunAt fields (see automation.service.js) — they were fully computed
// (calculateNextRun, ensureDefaults) but nothing ever polled them, so
// Automation.enabled defaulting to false meant every one of them (fee
// reminders, class reminders, birthday wishes, attendance alerts) has only
// ever run when an admin clicked "Run now". This is NOT a second scheduling
// system: it just periodically calls the SAME automationService.runAutomation()
// the manual "Run now" button already calls, for whichever automations are
// both enabled and due. Since Automation.enabled defaults to false for every
// automation, starting this poller changes nothing until an admin explicitly
// enables one — existing WhatsApp behavior (which today only ever runs
// on-demand) is unaffected unless they opt in.
let timer = null;

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

function start() {
  if (timer) return;
  const interval = Math.max(60000, Number(process.env.AUTOMATION_SCHEDULER_INTERVAL_MS || 300000));
  timer = setInterval(() => {
    tick().catch((error) => logger.warn('automation_scheduler_tick_failed', { error: error.message }));
  }, interval);
  if (timer.unref) timer.unref();
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop, tick };
