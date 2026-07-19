import { feeOptionLabel, installmentOptionLabel, installmentSelection, singleOptionId } from './paymentSlipReview';

test('one fee is auto-selected', () => expect(singleOptionId([{ id: 10 }])).toBe('10'));
test('multiple fees require selection', () => expect(singleOptionId([{ id: 10 }, { id: 11 }])).toBe(''));
test('no fee state has no selection', () => expect(singleOptionId([])).toBe(''));
test('one installment is selected and remaining balance fills confirmed amount', () => {
  expect(installmentSelection([{ id: 7, remainingBalance: 1250 }])).toEqual({ installmentId: '7', confirmedAmount: '1250' });
});
test('multiple installments require manual selection', () => {
  expect(installmentSelection([{ id: 7, remainingBalance: 100 }, { id: 8, remainingBalance: 200 }])).toEqual({ installmentId: '', confirmedAmount: '' });
});
test('no installment state has no amount', () => expect(installmentSelection([])).toEqual({ installmentId: '', confirmedAmount: '' }));
test('option labels contain business facts without an ID label', () => {
  expect(feeOptionLabel({ courseName: 'English', totalAmount: 5000, paidAmount: 1000, remainingBalance: 4000 })).toBe('English – Total Rs. 5,000.00 – Paid Rs. 1,000.00 – Remaining Rs. 4,000.00');
  expect(installmentOptionLabel({ installmentNo: 2, amount: 2000, paidAmount: 500, remainingBalance: 1500, dueDate: '2026-08-01', status: 'partially_paid' })).not.toMatch(/\bID\b/i);
});
