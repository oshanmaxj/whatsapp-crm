const RECEIPT_PERMISSIONS = [
  'receipts.view', 'receipts.generate', 'receipts.download', 'receipts.send_whatsapp',
  'receipts.regenerate', 'receipts.void', 'receipts.export', 'receipts.manage_settings'
];

async function tableExists(queryInterface, tableName, transaction) {
  return Boolean(await queryInterface.describeTable(tableName, { transaction }).catch(() => null));
}

async function ensureIndex(queryInterface, tableName, fields, options, transaction) {
  const indexes = await queryInterface.showIndex(tableName, { transaction }).catch(() => []);
  if (!indexes.some((index) => index.name === options.name)) {
    await queryInterface.addIndex(tableName, fields, { ...options, transaction });
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const migrate = async (transaction) => {
      const D = Sequelize.DataTypes;
      const queryOptions = { transaction };
      if (!await tableExists(queryInterface, 'payment_receipt_counters', transaction)) {
      await queryInterface.createTable('payment_receipt_counters', {
        year: { type: D.INTEGER, primaryKey: true },
        last_value: { type: D.BIGINT, allowNull: false, defaultValue: 0 },
        created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
        }, queryOptions);
      }

      if (!await tableExists(queryInterface, 'payment_receipts', transaction)) {
      await queryInterface.createTable('payment_receipts', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        receipt_number: { type: D.STRING(40), allowNull: false, unique: true },
        payment_id: { type: D.BIGINT, allowNull: false, references: { model: 'accounting_transactions', key: 'id' }, onDelete: 'RESTRICT' },
        student_id: { type: D.BIGINT, allowNull: false, references: { model: 'students', key: 'id' }, onDelete: 'RESTRICT' },
        student_fee_id: { type: D.BIGINT, allowNull: true, references: { model: 'student_fees', key: 'id' }, onDelete: 'SET NULL' },
        fee_installment_id: { type: D.BIGINT, allowNull: true, references: { model: 'fee_installments', key: 'id' }, onDelete: 'SET NULL' },
        course_id: { type: D.BIGINT, allowNull: true, references: { model: 'courses', key: 'id' }, onDelete: 'SET NULL' },
        batch_id: { type: D.BIGINT, allowNull: true, references: { model: 'batches', key: 'id' }, onDelete: 'SET NULL' },
        receipt_date: { type: D.DATE, allowNull: false },
        paid_amount: { type: D.DECIMAL(15, 2), allowNull: false },
        currency: { type: D.STRING(10), allowNull: false, defaultValue: 'LKR' },
        payment_method: { type: D.STRING(80), allowNull: true },
        transaction_reference: { type: D.STRING(180), allowNull: true },
        total_course_fee: { type: D.DECIMAL(15, 2), allowNull: true },
        total_paid_after_payment: { type: D.DECIMAL(15, 2), allowNull: true },
        remaining_balance: { type: D.DECIMAL(15, 2), allowNull: true },
        student_name_snapshot: { type: D.STRING(180), allowNull: false },
        student_number_snapshot: { type: D.STRING(80), allowNull: true },
        student_phone_snapshot: { type: D.STRING(50), allowNull: true },
        course_name_snapshot: { type: D.STRING(180), allowNull: true },
        batch_name_snapshot: { type: D.STRING(180), allowNull: true },
        payer_name_snapshot: { type: D.STRING(180), allowNull: true },
        verified_by_user_id: { type: D.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        generated_by_user_id: { type: D.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        generation_source: { type: D.STRING(30), allowNull: false },
        verification_token_hash: { type: D.STRING(64), allowNull: false, unique: true },
        verification_token_encrypted: { type: D.TEXT, allowNull: false },
        pdf_storage_key: { type: D.STRING(500), allowNull: true },
        pdf_file_hash: { type: D.STRING(64), allowNull: true },
        status: { type: D.STRING(20), allowNull: false, defaultValue: 'ACTIVE' },
        void_reason: { type: D.TEXT, allowNull: true },
        voided_by_user_id: { type: D.BIGINT, allowNull: true, references: { model: 'users', key: 'id' }, onDelete: 'SET NULL' },
        voided_at: { type: D.DATE, allowNull: true },
        whatsapp_sent_at: { type: D.DATE, allowNull: true },
        whatsapp_message_id: { type: D.STRING(255), allowNull: true },
        created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        deleted_at: { type: D.DATE, allowNull: true }
        }, queryOptions);
      }

      await ensureIndex(queryInterface, 'payment_receipts', ['payment_id'], { name: 'payment_receipts_payment_idx' }, transaction);
      await ensureIndex(queryInterface, 'payment_receipts', ['student_id'], { name: 'payment_receipts_student_idx' }, transaction);
      await ensureIndex(queryInterface, 'payment_receipts', ['receipt_date'], { name: 'payment_receipts_date_idx' }, transaction);
      await ensureIndex(queryInterface, 'payment_receipts', ['status'], { name: 'payment_receipts_status_idx' }, transaction);
      await ensureIndex(queryInterface, 'payment_receipts', ['fee_installment_id'], { name: 'payment_receipts_installment_idx' }, transaction);
      if (queryInterface.sequelize.getDialect() === 'postgres') {
        await queryInterface.sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS payment_receipts_one_active_per_payment
        ON payment_receipts (payment_id)
        WHERE status = 'ACTIVE' AND deleted_at IS NULL
        `, queryOptions);
      }

      if (!await tableExists(queryInterface, 'payment_receipt_jobs', transaction)) {
        await queryInterface.createTable('payment_receipt_jobs', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        receipt_id: { type: D.BIGINT, allowNull: false, references: { model: 'payment_receipts', key: 'id' }, onDelete: 'CASCADE' },
        job_type: { type: D.STRING(30), allowNull: false },
        dedupe_key: { type: D.STRING(180), allowNull: false, unique: true },
        status: { type: D.STRING(20), allowNull: false, defaultValue: 'QUEUED' },
        attempts: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
        max_attempts: { type: D.INTEGER, allowNull: false, defaultValue: 5 },
        run_after: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        actor_user_id: { type: D.BIGINT, allowNull: true },
        manual: { type: D.BOOLEAN, allowNull: false, defaultValue: false },
        last_error: { type: D.TEXT, allowNull: true },
        completed_at: { type: D.DATE, allowNull: true },
        created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
        }, queryOptions);
      }
      await ensureIndex(queryInterface, 'payment_receipt_jobs', ['status', 'run_after'], { name: 'payment_receipt_jobs_due_idx' }, transaction);
      await ensureIndex(queryInterface, 'payment_receipt_jobs', ['receipt_id', 'job_type'], { name: 'payment_receipt_jobs_receipt_type_idx' }, transaction);

      for (const code of RECEIPT_PERMISSIONS) {
        const [rows] = await queryInterface.sequelize.query('SELECT id FROM permissions WHERE code = :code', { replacements: { code }, transaction });
        if (!rows.length) await queryInterface.bulkInsert('permissions', [{ code, name: code, description: `Receipt permission: ${code}`, created_at: new Date(), updated_at: new Date() }], queryOptions);
        const [permission] = await queryInterface.sequelize.query('SELECT id FROM permissions WHERE code = :code', { replacements: { code }, transaction });
        const roleNames = ['admin', 'accountant', ...(code === 'receipts.void' || code === 'receipts.manage_settings' ? [] : ['manager'])];
        const [roles] = await queryInterface.sequelize.query('SELECT id FROM roles WHERE LOWER(name) IN (:roles) AND deleted_at IS NULL', { replacements: { roles: roleNames }, transaction });
        for (const role of roles) {
          const [mapping] = await queryInterface.sequelize.query('SELECT role_id FROM role_permissions WHERE role_id = :roleId AND permission_id = :permissionId', { replacements: { roleId: role.id, permissionId: permission[0].id }, transaction });
          if (!mapping.length) await queryInterface.bulkInsert('role_permissions', [{ role_id: role.id, permission_id: permission[0].id, granted_at: new Date() }], queryOptions);
        }
      }

      const [setting] = await queryInterface.sequelize.query("SELECT id FROM app_settings WHERE namespace = 'receipts' AND key = 'settings'", queryOptions);
      if (!setting.length) {
        const receiptSettings = {
          prefix: process.env.RECEIPT_PREFIX || 'RCPT',
          companyName: process.env.RECEIPT_COMPANY_NAME || 'First Of Education International (PVT) Ltd',
          registrationNumber: process.env.RECEIPT_COMPANY_REGISTRATION_NUMBER || 'PV 00267065',
          currency: process.env.RECEIPT_CURRENCY || 'LKR',
          autoGenerate: process.env.RECEIPT_AUTO_GENERATE !== 'false',
          autoSendWhatsapp: process.env.RECEIPT_AUTO_SEND_WHATSAPP !== 'false',
          footerText: 'This is a computer-generated receipt and does not require a physical signature.'
        };
        await queryInterface.bulkInsert('app_settings', [{
          // bulkInsert has no AppSetting model metadata, so serialize the JSON value explicitly.
          namespace: 'receipts', key: 'settings', value: JSON.stringify(receiptSettings),
          created_at: new Date(), updated_at: new Date()
        }], queryOptions);
      }
    };

    if (typeof queryInterface.sequelize.transaction === 'function') {
      return queryInterface.sequelize.transaction(migrate);
    }
    return migrate(undefined);
  },

  async down() {
    // Financial receipt history is intentionally retained. Roll back application code instead.
  }
};
