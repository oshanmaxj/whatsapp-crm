const test = require('node:test');
const assert = require('node:assert/strict');
const { FeeReminder, FeeInstallment } = require('../src/models');
const feeReminderService = require('../src/services/feeReminder.service');
const automation = require('../src/services/studentMessageAutomation.service');
const notificationService = require('../src/services/notification.service');

const originals = {
  feeReminderFindByPk: FeeReminder.findByPk,
  feeInstallmentUpdate: FeeInstallment.update,
  dispatch: automation.dispatch,
  dispatchSms: automation.dispatchSms,
  notify: notificationService.create
};

test.beforeEach(() => {
  notificationService.create = async () => null;
  FeeInstallment.update = async () => [1];
});

test.afterEach(() => {
  FeeReminder.findByPk = originals.feeReminderFindByPk;
  FeeInstallment.update = originals.feeInstallmentUpdate;
  automation.dispatch = originals.dispatch;
  automation.dispatchSms = originals.dispatchSms;
  notificationService.create = originals.notify;
});

function fakeReminder(installment, overrides = {}) {
  const row = {
    id: 1, studentId: 9, status: 'pending', scheduledDate: '2026-04-01',
    student: { id: 9, name: 'Pat' }, installment, ...overrides
  };
  row.update = async (fields) => { Object.assign(row, fields); return row; };
  return row;
}

function spyDispatchers() {
  let dispatchCalls = 0;
  let smsCalls = 0;
  automation.dispatch = async () => { dispatchCalls += 1; return { status: 'queued', queue: { id: 1 } }; };
  automation.dispatchSms = async () => { smsCalls += 1; return { status: 'sent' }; };
  return { calls: () => ({ dispatchCalls, smsCalls }) };
}

// --- 5: paid installment ------------------------------------------------------

test('#5 an already-paid installment never receives a payment reminder (WhatsApp or SMS)', async () => {
  const reminder = fakeReminder({ installmentNo: 1, amount: 5000, paidAmount: 5000, status: 'paid', dueDate: '2026-03-01' });
  FeeReminder.findByPk = async () => reminder;
  const spy = spyDispatchers();

  const result = await feeReminderService.sendReminder(1);

  assert.equal(spy.calls().dispatchCalls, 0);
  assert.equal(spy.calls().smsCalls, 0);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.response.mode, 'skipped_already_settled');
  assert.equal(result.response.installmentStatus, 'paid');
});

// --- 6: zero balance -----------------------------------------------------------

test('#6 a zero-balance installment (fully paid but status not yet flipped to "paid") never receives a reminder', async () => {
  const reminder = fakeReminder({ installmentNo: 1, amount: 5000, paidAmount: 5000, status: 'pending', dueDate: '2026-03-01' });
  FeeReminder.findByPk = async () => reminder;
  const spy = spyDispatchers();

  const result = await feeReminderService.sendReminder(1);

  assert.equal(spy.calls().dispatchCalls, 0);
  assert.equal(spy.calls().smsCalls, 0);
  assert.equal(result.status, 'cancelled');
  assert.equal(result.response.outstanding, 0);
});

// --- 7: cancelled installment ("fully settled" family) -------------------------

test('#7 a cancelled installment never receives a reminder', async () => {
  const reminder = fakeReminder({ installmentNo: 1, amount: 5000, paidAmount: 0, status: 'cancelled', dueDate: '2026-03-01' });
  FeeReminder.findByPk = async () => reminder;
  const spy = spyDispatchers();

  const result = await feeReminderService.sendReminder(1);

  assert.equal(spy.calls().dispatchCalls, 0);
  assert.equal(spy.calls().smsCalls, 0);
  assert.equal(result.status, 'cancelled');
});

test('an installment row that can no longer be found at send time is treated fail-closed (skipped, not sent)', async () => {
  const reminder = fakeReminder(null);
  FeeReminder.findByPk = async () => reminder;
  const spy = spyDispatchers();

  const result = await feeReminderService.sendReminder(1);

  assert.equal(spy.calls().smsCalls, 0);
  assert.equal(result.response.installmentStatus, 'not_found');
});

// --- 8: genuinely due installment sends exactly once ----------------------------

test('#8 an unpaid, genuinely due installment sends exactly one WhatsApp dispatch and one SMS dispatch', async () => {
  const reminder = fakeReminder({ installmentNo: 1, amount: 5000, paidAmount: 1000, status: 'due_today', dueDate: '2026-04-01' });
  FeeReminder.findByPk = async () => reminder;
  const spy = spyDispatchers();

  const result = await feeReminderService.sendReminder(1);

  assert.equal(spy.calls().dispatchCalls, 1);
  assert.equal(spy.calls().smsCalls, 1);
  assert.equal(result.status, 'sent');
});

// --- 9: repeated execution never duplicates ------------------------------------

test('#9 calling sendReminder again for an already-sent reminder never dispatches again (no duplicate SMS)', async () => {
  const reminder = fakeReminder({ installmentNo: 1, amount: 5000, paidAmount: 1000, status: 'due_today', dueDate: '2026-04-01' });
  FeeReminder.findByPk = async () => reminder;
  const spy = spyDispatchers();

  await feeReminderService.sendReminder(1);
  assert.equal(reminder.status, 'sent');
  await feeReminderService.sendReminder(1); // reminder.status is now 'sent'

  assert.equal(spy.calls().dispatchCalls, 1, 'the second call must short-circuit on status===sent and never dispatch again');
  assert.equal(spy.calls().smsCalls, 1);
});

// --- 10: burst/batch safety limit -----------------------------------------------

test('#10 sendBulkReminders caps each run to MAX_REMINDERS_PER_RUN (default 50) via a query limit, so a large backlog cannot all send in one pass', async () => {
  const originalGenerateAll = feeReminderService.generateAll;
  feeReminderService.generateAll = async () => ({});
  const originalReminderFindAll = FeeReminder.findAll;
  let capturedLimit = null;
  FeeReminder.findAll = async (opts) => { capturedLimit = opts.limit; return []; };

  await feeReminderService.sendBulkReminders();

  assert.equal(capturedLimit, 50);

  feeReminderService.generateAll = originalGenerateAll;
  FeeReminder.findAll = originalReminderFindAll;
});
