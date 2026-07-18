const { Op } = require('sequelize');
const { Message, FeeReminder } = require('../models');

const EXPLICIT = ['payment slip', 'bank slip', 'transfer receipt', 'deposit receipt', 'slip eka', 'payment eka', 'ස්ලිප් එක', 'පේමන්ට් එක'];
const PAYMENT_WORDS = ['payment', 'paid', 'slip', 'transfer', 'deposit', 'receipt', 'installment', 'course fee', 'class fee', 'registration fee', 'ගෙවීම', 'සල්ලි දැම්මා', 'මුදල් බැර කළා', 'ගෙවලා තියෙන්නේ', 'බැංකුවට දැම්මා', 'වාරිකය', 'පන්ති ගාස්තුව', 'රෙජිස්ට්‍රේෂන් ගාස්තුව'];
const OCR_WORDS = ['successful', 'transfer', 'deposit', 'receipt', 'transaction', 'reference', 'amount', 'bank'];

function normalizedText(value) { return String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(); }
function add(signals, code, weight, detail) { signals.push({ code, weight, detail }); }

async function conversationSignals({ conversation, match, transaction }) {
  if (!conversation?.id) return [];
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const recent = await Message.findAll({ where: { conversationId: conversation.id, createdAt: { [Op.gte]: since } }, attributes: ['direction', 'text', 'buttonPayload', 'messageType'], order: [['created_at', 'DESC']], limit: 30, transaction });
  const text = normalizedText(recent.map((row) => `${row.text || ''} ${row.buttonPayload || ''}`).join(' '));
  const signals = [];
  if (/(send|share).{0,30}(slip|proof)|fee reminder|payment reminder|i have paid|waiting.for.slip|payment.pending/.test(text)) add(signals, 'RECENT_PAYMENT_REQUEST', 0.28);
  if (match?.matchedInstallmentId || match?.candidates?.installments?.length) add(signals, 'OUTSTANDING_INSTALLMENT', 0.16);
  if (match?.matchedStudentId) {
    const reminder = await FeeReminder.findOne({ where: { studentId: match.matchedStudentId, createdAt: { [Op.gte]: since } }, transaction, order: [['created_at', 'DESC']] });
    if (reminder) add(signals, 'RECENT_FEE_REMINDER', 0.25);
  }
  return signals;
}

async function detectWhatsAppPaymentSlip({ message, media, conversation, contact, extracted = {}, match = {}, transaction }) {
  const signals = [];
  const warnings = [...(extracted.warnings || []), ...(match.warnings || [])];
  const caption = normalizedText(`${message?.text || ''} ${media?.caption || ''}`);
  const explicit = EXPLICIT.find((word) => caption.includes(word));
  if (explicit) add(signals, 'EXPLICIT_PAYMENT_CAPTION', 0.48, explicit);
  else {
    const hits = PAYMENT_WORDS.filter((word) => caption.includes(word));
    if (hits.length) add(signals, 'PAYMENT_CAPTION_TERMS', Math.min(0.12 + hits.length * 0.06, 0.30), hits.slice(0, 5));
  }
  const ocr = normalizedText(extracted.rawText);
  const ocrHits = OCR_WORDS.filter((word) => ocr.includes(word));
  if (ocrHits.length) add(signals, 'OCR_PAYMENT_TERMS', Math.min(0.08 + ocrHits.length * 0.025, 0.18), ocrHits);
  const structured = [extracted.amount, extracted.referenceNumber, extracted.bankName].filter(Boolean).length;
  if (structured >= 2) add(signals, 'OCR_STRUCTURED_FIELDS', structured === 3 ? 0.34 : 0.23, structured);
  signals.push(...await conversationSignals({ conversation, match, transaction }));
  if (media && ['image/jpeg', 'image/png', 'application/pdf'].includes(String(media.mimeType).toLowerCase())) add(signals, 'SUPPORTED_RECEIPT_MEDIA', 0.06, media.mimeType);
  const confidence = Math.min(1, Number(signals.reduce((sum, item) => sum + item.weight, 0).toFixed(4)));
  return {
    isLikelyPaymentSlip: confidence >= Number(process.env.WHATSAPP_SLIP_REVIEW_THRESHOLD || 0.50), confidence, signals,
    extractedData: {
      amount: extracted.amount || null, transactionDate: extracted.transactionDate || null, transactionTime: extracted.transactionTime || null,
      bankName: extracted.bankName || null, referenceNumber: extracted.referenceNumber || null, payerName: extracted.payerName || null,
      destinationAccount: extracted.destinationAccount || null
    },
    matchedStudentId: match.matchedStudentId || null, matchedStudentFeeId: match.matchedStudentFeeId || null,
    matchedInstallmentId: match.matchedInstallmentId || null, warnings
  };
}

module.exports = { detectWhatsAppPaymentSlip, normalizedText, PAYMENT_WORDS };
