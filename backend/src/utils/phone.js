function normalizePhone(value) {
  let digits = String(value ?? '').trim().replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  const sriLankan = normalizeSriLankanPhone(digits);
  if (sriLankan) return sriLankan;
  return /^\d{7,15}$/.test(digits) ? digits : null;
}

function normalizeSriLankanPhone(value) {
  let digits = String(value ?? '').trim().replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^07\d{8}$/.test(digits)) return `94${digits.slice(1)}`;
  if (/^7\d{8}$/.test(digits)) return `94${digits}`;
  return /^947\d{8}$/.test(digits) ? digits : null;
}

function sriLankanPhoneCandidates(value) {
  const normalized = normalizeSriLankanPhone(value);
  if (!normalized) return [];
  return Array.from(new Set([normalized, `+${normalized}`, `0${normalized.slice(2)}`, normalized.slice(2)]));
}

function requireNormalizedPhone(value) {
  const normalized = normalizePhone(value);
  if (normalized) return normalized;
  throw Object.assign(new Error('A valid phone number is required.'), {
    status: 400,
    code: 'INVALID_PHONE_NUMBER'
  });
}

module.exports = { normalizePhone, normalizeSriLankanPhone, requireNormalizedPhone, sriLankanPhoneCandidates };
