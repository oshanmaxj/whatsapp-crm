const models = require('../models');
const receiptSettings = require('./paymentReceiptSettings.service');

function createPaymentReceiptNumberService(dependencies = {}) {
  const sequelize = dependencies.sequelize || models.sequelize;
  const settingsService = dependencies.settingsService || receiptSettings;

  return {
    async next({ receiptDate = new Date(), transaction }) {
      if (!transaction) throw Object.assign(new Error('Receipt number generation requires a transaction'), { code: 'RECEIPT_TRANSACTION_REQUIRED' });
      const year = new Date(receiptDate).getUTCFullYear();
      const [rows] = await sequelize.query(`
        INSERT INTO payment_receipt_counters (year, last_value, created_at, updated_at)
        VALUES (:year, 1, NOW(), NOW())
        ON CONFLICT (year)
        DO UPDATE SET last_value = payment_receipt_counters.last_value + 1, updated_at = NOW()
        RETURNING last_value
      `, { replacements: { year }, transaction });
      const sequence = Number(rows?.[0]?.last_value);
      if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 999999) {
        throw Object.assign(new Error(`Receipt sequence exhausted or invalid for ${year}`), { code: 'RECEIPT_SEQUENCE_INVALID' });
      }
      const settings = await settingsService.get();
      const prefix = String(settings.prefix || 'RCPT').replace(/[^A-Za-z0-9-]/g, '').toUpperCase() || 'RCPT';
      return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
    }
  };
}

module.exports = createPaymentReceiptNumberService();
module.exports.createPaymentReceiptNumberService = createPaymentReceiptNumberService;
