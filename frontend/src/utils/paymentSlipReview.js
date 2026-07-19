const amount = (value) => Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const singleOptionId = (options = []) => options.length === 1 ? String(options[0].id) : '';

export const feeOptionLabel = (fee) => (
  `${fee.courseName} – Total Rs. ${amount(fee.totalAmount)} – Paid Rs. ${amount(fee.paidAmount)} – Remaining Rs. ${amount(fee.remainingBalance)}`
);

export const installmentOptionLabel = (installment) => (
  `Installment ${installment.installmentNo} – Amount Rs. ${amount(installment.amount)} – Paid Rs. ${amount(installment.paidAmount)} – Remaining Rs. ${amount(installment.remainingBalance)} – Due ${installment.dueDate || 'Not set'} – ${String(installment.status || '').replaceAll('_', ' ')}`
);

export const installmentSelection = (options = [], preferredId = '') => {
  const selected = options.find((item) => String(item.id) === String(preferredId))
    || (options.length === 1 ? options[0] : null);
  return {
    installmentId: selected ? String(selected.id) : '',
    confirmedAmount: selected ? String(selected.remainingBalance) : ''
  };
};
