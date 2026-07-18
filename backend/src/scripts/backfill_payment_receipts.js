require('dotenv').config();
const { AccountingTransaction, FeeInstallment, PaymentReceipt, sequelize } = require('../models');
const receiptService = require('../services/paymentReceipt.service');
const pdfService = require('../services/paymentReceiptPdf.service');
const deliveryService = require('../services/paymentReceiptDelivery.service');

async function run() {
  const apply = process.argv.includes('--apply');
  const generatePdf = process.argv.includes('--generate-pdf');
  const sendWhatsapp = process.argv.includes('--send-whatsapp');
  if (sendWhatsapp && !generatePdf) throw new Error('--send-whatsapp requires --generate-pdf');
  await sequelize.authenticate();
  const payments = await AccountingTransaction.findAll({ where: { type: 'income' }, order: [['id', 'ASC']] });
  const report = { mode: apply ? 'apply' : 'report', eligible: [], existing: [], ambiguous: [], failed: [] };

  for (const payment of payments) {
    const existing = await PaymentReceipt.findOne({ where: { paymentId: payment.id, status: 'ACTIVE' } });
    if (existing) { report.existing.push({ paymentId: payment.id, receiptNumber: existing.receiptNumber }); continue; }
    const installments = await FeeInstallment.findAll({ where: { accountingTransactionId: payment.id } });
    if (installments.length !== 1 || !['confirmed', 'paid'].includes(installments[0]?.status)) {
      report.ambiguous.push({ paymentId: payment.id, installmentCandidates: installments.map((row) => row.id) });
      continue;
    }
    report.eligible.push({ paymentId: payment.id, installmentId: installments[0].id });
    if (!apply) continue;
    try {
      const result = await receiptService.generatePaymentReceipt({
        paymentId: payment.id, actorType: 'SYSTEM', actorUserId: null,
        generationSource: 'IMPORT', generatePdf: false
      });
      if (generatePdf) await pdfService.generate(result.receipt.id);
      if (sendWhatsapp) await deliveryService.send(result.receipt.id, { manual: false, actorUserId: null });
    } catch (error) {
      report.failed.push({ paymentId: payment.id, code: error.code || null, message: error.message });
    }
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) run().then(() => sequelize.close()).catch(async (error) => { process.stderr.write(`${error.stack}\n`); await sequelize.close().catch(() => {}); process.exitCode = 1; });
module.exports = { run };
