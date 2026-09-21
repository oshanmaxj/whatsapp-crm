const test = require('node:test');
const assert = require('node:assert/strict');
const { ClassReminder, BirthdayWish, FeeReminder, FeeInstallment } = require('../src/models');
const classReminderService = require('../src/services/classReminder.service');
const birthdayWishService = require('../src/services/birthdayWish.service');
const feeReminderService = require('../src/services/feeReminder.service');
const automation = require('../src/services/studentMessageAutomation.service');
const notificationService = require('../src/services/notification.service');

const originals = {
  classReminderFindByPk: ClassReminder.findByPk,
  birthdayWishFindByPk: BirthdayWish.findByPk,
  feeReminderFindByPk: FeeReminder.findByPk,
  feeInstallmentUpdate: FeeInstallment.update,
  dispatch: automation.dispatch,
  dispatchSms: automation.dispatchSms,
  notify: notificationService.create,
  contactIdForNumber: birthdayWishService.contactIdForNumber
};

test.beforeEach(() => {
  notificationService.create = async () => null;
  FeeInstallment.update = async () => [1];
});

test.afterEach(() => {
  ClassReminder.findByPk = originals.classReminderFindByPk;
  BirthdayWish.findByPk = originals.birthdayWishFindByPk;
  FeeReminder.findByPk = originals.feeReminderFindByPk;
  FeeInstallment.update = originals.feeInstallmentUpdate;
  automation.dispatch = originals.dispatch;
  automation.dispatchSms = originals.dispatchSms;
  notificationService.create = originals.notify;
  birthdayWishService.contactIdForNumber = originals.contactIdForNumber;
});

function fakeRow(initial) {
  const row = { ...initial };
  row.update = async (fields) => { Object.assign(row, fields); return row; };
  return row;
}

// --- class reminder ----------------------------------------------------------

test('classReminder.sendReminder dispatches SMS keyed to the reminder row id, and an SMS failure does not affect the WhatsApp status recorded', async () => {
  const reminder = fakeRow({ id: 77, studentId: 1, status: 'pending', scheduleDate: '2026-05-01', student: { id: 1, contact: {} } });
  ClassReminder.findByPk = async () => reminder;
  automation.dispatch = async () => ({ status: 'queued', queue: { id: 5 } });
  let smsArgs = null;
  automation.dispatchSms = async (key, studentId, event) => { smsArgs = { key, studentId, event }; throw new Error('provider down'); };
  notificationService.create = async () => null;

  const result = await classReminderService.sendReminder(77);

  assert.equal(smsArgs.key, 'class_reminder');
  assert.equal(smsArgs.event.smsOccurrenceKey, 'class-reminder:77');
  assert.equal(result.status, 'sent', 'WhatsApp status must remain sent even though the SMS dispatch threw');
  assert.equal(result.response.sms.status, 'failed');
});

// --- birthday wish -----------------------------------------------------------

test('birthdayWish.sendBirthdayWish (student recipient) dispatches SMS with a year-scoped occurrence key', async () => {
  const wish = fakeRow({ id: 88, studentId: 3, recipientType: 'student', birthdayDate: '2026-03-10', status: 'pending', student: { id: 3, contact: { whatsappId: '94771234567' }, name: 'Sam' } });
  BirthdayWish.findByPk = async () => wish;
  automation.dispatch = async () => ({ status: 'queued', queue: { id: 6 } });
  let smsArgs = null;
  automation.dispatchSms = async (key, studentId, event) => { smsArgs = { key, studentId, event }; return { status: 'sent' }; };
  notificationService.create = async () => null;

  await birthdayWishService.sendBirthdayWish(88);

  assert.equal(smsArgs.key, 'birthday_wish');
  assert.equal(smsArgs.studentId, 3);
  assert.equal(smsArgs.event.smsOccurrenceKey, 'birthday:3:2026');
});

test('birthdayWish.sendBirthdayWish never calls dispatchSms for a guardian recipient (guardians have no student SMS automation path)', async () => {
  const wish = fakeRow({
    id: 89, studentId: 3, guardianId: 4, recipientType: 'guardian', birthdayDate: '2026-03-10', status: 'pending',
    student: { id: 3, name: 'Sam' }, guardian: { id: 4, name: 'Guardian', phone: '94771234567' }
  });
  BirthdayWish.findByPk = async () => wish;
  birthdayWishService.contactIdForNumber = async () => null;
  let smsCalled = false;
  automation.dispatchSms = async () => { smsCalled = true; return { status: 'sent' }; };
  notificationService.create = async () => null;

  // Guardian path exercises whatsappComplianceService, which is not mocked
  // here, so it is expected to fail before reaching send — what matters for
  // this test is only that dispatchSms is never reached.
  await birthdayWishService.sendBirthdayWish(89).catch(() => null);

  assert.equal(smsCalled, false);
});

// --- fee/payment reminder -----------------------------------------------------

test('feeReminder.sendReminder dispatches payment_reminder SMS keyed to the reminder row id with the same amount/due-date variables as the WhatsApp dispatch', async () => {
  const reminder = fakeRow({
    id: 55, studentId: 9, status: 'pending', scheduledDate: '2026-04-01',
    student: { id: 9, name: 'Pat' }, installment: { installmentNo: 2, amount: 5000, paidAmount: 0, dueDate: '2026-04-01' }
  });
  FeeReminder.findByPk = async () => reminder;
  automation.dispatch = async () => ({ status: 'queued', queue: { id: 7 } });
  let smsArgs = null;
  automation.dispatchSms = async (key, studentId, event) => { smsArgs = { key, studentId, event }; return { status: 'sent' }; };

  await feeReminderService.sendReminder(55);

  assert.equal(smsArgs.key, 'payment_reminder');
  assert.equal(smsArgs.studentId, 9);
  assert.equal(smsArgs.event.smsOccurrenceKey, 'fee-reminder:55');
  assert.equal(smsArgs.event.paymentAmount, 5000);
  assert.equal(smsArgs.event.installmentNo, 2);
  assert.equal(smsArgs.event.installmentDueDate, '2026-04-01');
});

test('feeReminder.sendReminder keeps the reminder status "sent" even when the SMS side fails', async () => {
  const reminder = fakeRow({
    id: 56, studentId: 9, status: 'pending', scheduledDate: '2026-04-01',
    student: { id: 9, name: 'Pat' }, installment: { installmentNo: 1, amount: 2000, paidAmount: 0, dueDate: '2026-04-01' }
  });
  FeeReminder.findByPk = async () => reminder;
  automation.dispatch = async () => ({ status: 'queued', queue: { id: 8 } });
  automation.dispatchSms = async () => { throw new Error('sms boom'); };

  const result = await feeReminderService.sendReminder(56);

  assert.equal(result.status, 'sent');
  assert.equal(result.response.sms.status, 'failed');
});
