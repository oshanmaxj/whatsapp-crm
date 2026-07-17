function normalizePhone(value) {
  let digits = String(value ?? '').trim().replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) digits = `94${digits.slice(1)}`;
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

function requireNormalizedPhone(value) {
  const normalized = normalizePhone(value);
  if (normalized) return normalized;
  throw Object.assign(new Error('A valid phone number is required.'), {
    status: 400,
    code: 'INVALID_PHONE_NUMBER'
  });
}

const normalizeSriLankanPhone = normalizePhone;

module.exports = { normalizePhone, normalizeSriLankanPhone, requireNormalizedPhone };
