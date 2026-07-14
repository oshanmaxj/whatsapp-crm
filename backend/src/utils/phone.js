function normalizeSriLankanPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) digits = `94${digits.slice(1)}`;
  return digits;
}

module.exports = { normalizeSriLankanPhone };
