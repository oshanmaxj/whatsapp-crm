const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const { PaymentReceipt, User } = require('../models');
const storageService = require('./storage.service');
const receiptStorageService = require('./paymentReceiptStorage.service');
const settingsService = require('./paymentReceiptSettings.service');
const { decryptToken } = require('./paymentReceiptCrypto.service');

const money = (value, currency = 'LKR') => `${currency} ${Number(value || 0).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const maskPhone = (value) => value ? `${'*'.repeat(Math.max(String(value).length - 4, 4))}${String(value).slice(-4)}` : '-';
const maskReference = (value) => {
  const text = String(value || '');
  if (!text) return '-';
  if (text.length <= 6) return `${'*'.repeat(Math.max(text.length - 2, 2))}${text.slice(-2)}`;
  return `${text.slice(0, 2)}${'*'.repeat(Math.min(text.length - 6, 10))}${text.slice(-4)}`;
};

function readableAsset(asset, storage = storageService) {
  if (!asset || /^https?:/i.test(asset)) return null;
  try {
    if (/^data:image\/(?:png|jpe?g);base64,/i.test(asset)) return Buffer.from(asset.split(',')[1], 'base64');
    const storageKey = String(asset).replace(/^\/?uploads[\\/]/i, '');
    const file = /^[A-Za-z]:[\\/]/.test(asset) ? path.resolve(asset) : storage.resolvePrivatePath(storageKey);
    return fs.existsSync(file) ? file : null;
  } catch (_) {
    return null;
  }
}

function createPaymentReceiptPdfService(dependencies = {}) {
  const Receipt = dependencies.PaymentReceipt || PaymentReceipt;
  const UserModel = dependencies.User || User;
  const storage = dependencies.storageService || storageService;
  const receiptStorage = dependencies.receiptStorageService || receiptStorageService;
  const settings = dependencies.settingsService || settingsService;
  const PDF = dependencies.PDFDocument || PDFDocument;
  const qr = dependencies.QRCode || QRCode;

  async function render(receipt, config, verifierName, verificationUrl) {
    const qrDataUrl = await qr.toDataURL(verificationUrl, { margin: 1, width: 150, errorCorrectionLevel: 'M' });
    const qrBuffer = Buffer.from(qrDataUrl.split(',')[1], 'base64');
    return new Promise((resolve, reject) => {
      const chunks = [];
      const doc = new PDF({ size: 'A4', margin: 44, info: { Title: `Payment Receipt ${receipt.receiptNumber}`, Author: config.companyName }, compress: false });
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('error', reject);
      doc.on('end', () => resolve(Buffer.concat(chunks)));

      const logo = readableAsset(config.logoUrl, storage);
      if (logo) doc.image(logo, 44, 38, { fit: [90, 55] });
      doc.font('Helvetica-Bold').fontSize(16).text(config.companyName, logo ? 145 : 44, 42, { align: logo ? 'left' : 'center' });
      doc.font('Helvetica').fontSize(9).text([
        config.registrationNumber ? `Registration: ${config.registrationNumber}` : '',
        config.address || '',
        [config.phone, config.email].filter(Boolean).join('  |  ')
      ].filter(Boolean).join('\n'), { align: logo ? 'left' : 'center' });
      doc.moveDown(1.2).font('Helvetica-Bold').fontSize(20).fillColor('#128c7e').text('PAYMENT RECEIPT', { align: 'center' }).fillColor('#111111');
      doc.moveDown(0.8);

      if (receipt.status !== 'ACTIVE') {
        doc.save().rotate(-28, { origin: [300, 400] }).font('Helvetica-Bold').fontSize(72).fillColor('#d32f2f').opacity(0.16).text(receipt.status, 80, 350, { align: 'center' }).restore().opacity(1).fillColor('#111111');
      }

      const labelValue = (label, value, x, y, width = 245) => {
        doc.font('Helvetica-Bold').fontSize(9).text(label, x, y, { width });
        doc.font('Helvetica').fontSize(10).text(value == null || value === '' ? '-' : String(value), x, y + 13, { width });
      };
      let y = doc.y;
      labelValue('Receipt No', receipt.receiptNumber, 44, y);
      labelValue('Receipt Date', new Date(receipt.receiptDate).toLocaleDateString('en-GB'), 310, y);
      y += 42;
      labelValue('Payment Status', receipt.status === 'ACTIVE' ? 'PAID' : receipt.status, 44, y);
      labelValue('Generated', new Date().toLocaleString('en-GB'), 310, y);
      y += 55;
      doc.moveTo(44, y).lineTo(551, y).strokeColor('#d7e5e2').stroke();
      y += 16;
      doc.font('Helvetica-Bold').fontSize(12).text('Student information', 44, y);
      y += 23;
      labelValue('Student Name', receipt.studentNameSnapshot, 44, y);
      labelValue('Registration No', receipt.studentNumberSnapshot, 310, y);
      y += 42;
      labelValue('Phone', maskPhone(receipt.studentPhoneSnapshot), 44, y);
      labelValue('Course / Batch', [receipt.courseNameSnapshot, receipt.batchNameSnapshot].filter(Boolean).join(' / '), 310, y);
      y += 58;
      doc.font('Helvetica-Bold').fontSize(12).text('Payment details', 44, y);
      y += 23;
      labelValue('Payment Method', receipt.paymentMethod, 44, y);
      labelValue('Transaction Reference', maskReference(receipt.transactionReference), 310, y);
      y += 42;
      labelValue('Installment', receipt.feeInstallmentId ? 'Fee installment payment' : 'Full / imported payment', 44, y);
      labelValue('Amount Paid', money(receipt.paidAmount, receipt.currency), 310, y);
      y += 42;
      labelValue('Total Course Fee', receipt.totalCourseFee == null ? '-' : money(receipt.totalCourseFee, receipt.currency), 44, y);
      labelValue('Total Paid', receipt.totalPaidAfterPayment == null ? '-' : money(receipt.totalPaidAfterPayment, receipt.currency), 310, y);
      y += 42;
      labelValue('Remaining Balance', receipt.remainingBalance == null ? '-' : money(receipt.remainingBalance, receipt.currency), 44, y);
      labelValue('Verified By', verifierName || 'Finance team', 310, y);

      const signature = readableAsset(config.signatureUrl, storage);
      if (signature) doc.image(signature, 44, 610, { fit: [125, 55] });
      doc.image(qrBuffer, 438, 610, { width: 92 });
      doc.font('Helvetica').fontSize(7).fillColor('#555555').text('Scan to verify', 438, 706, { width: 92, align: 'center' });
      doc.fontSize(8).text(config.footerText, 44, 720, { width: 370, align: 'center' });
      doc.fontSize(7).text('Private financial document. Verify authenticity using the QR code.', 44, 748, { width: 507, align: 'center' });
      doc.end();
    });
  }

  return {
    async generate(receiptId) {
      const receiptModel = typeof Receipt.scope === 'function' ? Receipt.scope('withVerificationToken') : Receipt;
      const receipt = await receiptModel.findByPk(receiptId);
      if (!receipt) throw Object.assign(new Error('Receipt not found'), { status: 404, code: 'RECEIPT_NOT_FOUND' });
      const [config, verifier] = await Promise.all([
        settings.get(),
        receipt.verifiedByUserId ? UserModel.findByPk(receipt.verifiedByUserId) : null
      ]);
      const token = decryptToken(receipt.verificationTokenEncrypted);
      const verificationUrl = `${String(config.verificationBaseUrl).replace(/\/$/, '')}/${token}`;
      const verifierName = verifier ? [verifier.firstName, verifier.lastName].filter(Boolean).join(' ') : null;
      const buffer = await render(receipt, config, verifierName, verificationUrl);
      const storageKey = await receiptStorage.store(buffer, new Date(receipt.receiptDate).getUTCFullYear());
      const pdfFileHash = crypto.createHash('sha256').update(buffer).digest('hex');
      await receipt.update({ pdfStorageKey: storageKey, pdfFileHash });
      return { receipt, buffer, storageKey, hash: pdfFileHash };
    },
    render,
    maskReference,
    maskPhone
  };
}

module.exports = createPaymentReceiptPdfService();
module.exports.createPaymentReceiptPdfService = createPaymentReceiptPdfService;
