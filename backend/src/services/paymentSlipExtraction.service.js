const BANKS = ['bank of ceylon', 'boc', 'commercial bank', 'sampath bank', 'hatton national bank', 'hnb', 'peoples bank', "people's bank", 'nations trust bank', 'ntb', 'seylan bank', 'dfcc', 'nations trust', 'union bank'];
const providers = new Map();

function normalizedResult(input = {}) {
  return {
    amount: input.amount == null ? null : Number(input.amount), transactionDate: input.transactionDate || null,
    transactionTime: input.transactionTime || null, bankName: input.bankName || null, referenceNumber: input.referenceNumber || null,
    payerName: input.payerName || null, destinationAccount: input.destinationAccount || null, rawText: input.rawText || '',
    confidence: Number(input.confidence || 0), fieldsConfidence: input.fieldsConfidence || {}, warnings: input.warnings || []
  };
}

function extractFields(rawText) {
  const text = String(rawText || '');
  const lower = text.toLowerCase();
  const amount = text.match(/(?:lkr|rs\.?|රු\.?)[\s:]*(\d[\d,]*(?:\.\d{1,2})?)/i)?.[1]?.replace(/,/g, '') || null;
  const referenceNumber = text.match(/(?:reference|ref|transaction\s*id|txn\s*id)[\s:#-]*([a-z0-9-]{5,})/i)?.[1] || null;
  const date = text.match(/\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2})\b/)?.[1] || null;
  const time = text.match(/\b([01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/)?.[0] || null;
  const bankName = BANKS.find((bank) => lower.includes(bank)) || null;
  const fields = [amount, referenceNumber, date, bankName].filter(Boolean).length;
  return normalizedResult({ amount, referenceNumber, transactionDate: date, transactionTime: time, bankName, rawText: text, confidence: fields / 4 });
}

async function extractPaymentSlipFromMedia({ mediaPath, mimeType, provider = process.env.PAYMENT_SLIP_OCR_PROVIDER || 'manual', adapter }) {
  if (!['image/jpeg', 'image/png', 'application/pdf'].includes(String(mimeType || '').toLowerCase())) return normalizedResult({ warnings: ['UNSUPPORTED_MIME_TYPE'] });
  if (!provider || ['manual', 'disabled', 'none'].includes(String(provider).toLowerCase())) return normalizedResult({ warnings: ['OCR_NOT_CONFIGURED'] });
  const providerAdapter = adapter || providers.get(String(provider).toLowerCase());
  if (typeof providerAdapter !== 'function') return normalizedResult({ warnings: [`OCR_PROVIDER_UNAVAILABLE:${provider}`] });
  try {
    const extracted = await providerAdapter({ mediaPath, mimeType });
    return normalizedResult({ ...extractFields(extracted?.rawText), ...extracted });
  }
  catch (_) { return normalizedResult({ warnings: ['OCR_EXTRACTION_FAILED'] }); }
}

function registerPaymentSlipOcrProvider(name, adapter) {
  if (!name || typeof adapter !== 'function') throw new TypeError('OCR provider name and adapter function are required.');
  providers.set(String(name).toLowerCase(), adapter);
}

module.exports = { extractPaymentSlipFromMedia, extractFields, normalizedResult, registerPaymentSlipOcrProvider };
