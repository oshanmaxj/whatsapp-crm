const PERMISSIONS = [
  ['payment-slips.view', 'Payment Slips View', 'View the WhatsApp payment verification queue'],
  ['payment-slips.review', 'Payment Slips Review', 'Review and rerun payment-slip detection'],
  ['payment-slips.approve', 'Payment Slips Approve', 'Approve, reject, or mark payment slips as duplicates'],
  ['payment-slips.mark', 'Payment Slips Mark', 'Mark an inbound WhatsApp message as a payment slip']
];

async function exists(q, table, transaction) {
  return Boolean(await q.describeTable(table, { transaction }).catch(() => null));
}

module.exports = {
  async up(q, Sequelize) {
    const migrate = async (transaction) => {
      const D = Sequelize.DataTypes;
      const json = D.JSONB || D.JSON;
      const queryOptions = { transaction };
      if (!(await exists(q, 'payment_slips', transaction))) {
        await q.createTable('payment_slips', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true },
        student_id: { type: D.BIGINT, allowNull: true }, lead_id: { type: D.BIGINT, allowNull: true },
        contact_id: { type: D.BIGINT, allowNull: true }, conversation_id: { type: D.BIGINT, allowNull: true },
        whatsapp_message_id: { type: D.BIGINT, allowNull: true }, whatsapp_account_id: { type: D.BIGINT, allowNull: true },
        student_fee_id: { type: D.BIGINT, allowNull: true }, fee_installment_id: { type: D.BIGINT, allowNull: true },
        source: { type: D.STRING(30), allowNull: false, defaultValue: 'WHATSAPP' }, media_id: { type: D.BIGINT, allowNull: true },
        file_url: { type: D.STRING(512), allowNull: true }, original_filename: { type: D.STRING(255), allowNull: true },
        mime_type: { type: D.STRING(150), allowNull: true }, file_size: { type: D.BIGINT, allowNull: true },
        file_hash: { type: D.STRING(64), allowNull: true }, perceptual_hash: { type: D.STRING(128), allowNull: true },
        message_caption: { type: D.TEXT, allowNull: true }, detection_confidence: { type: D.DECIMAL(5, 4), allowNull: true },
        detection_signals: { type: json, allowNull: false, defaultValue: [] }, detection_warnings: { type: json, allowNull: false, defaultValue: [] },
        match_candidates: { type: json, allowNull: false, defaultValue: {} }, submitted_amount: { type: D.DECIMAL(15, 2), allowNull: true },
        detected_amount: { type: D.DECIMAL(15, 2), allowNull: true }, confirmed_amount: { type: D.DECIMAL(15, 2), allowNull: true },
        detected_bank: { type: D.STRING(180), allowNull: true }, destination_bank_account: { type: D.STRING(80), allowNull: true },
        reference_number: { type: D.STRING(180), allowNull: true }, transaction_date: { type: D.DATEONLY, allowNull: true },
        transaction_time: { type: D.TIME, allowNull: true }, payer_name: { type: D.STRING(180), allowNull: true },
        ocr_raw_text: { type: D.TEXT, allowNull: true }, ocr_data: { type: json, allowNull: true }, ocr_confidence: { type: D.DECIMAL(5, 4), allowNull: true },
        verification_status: { type: D.STRING(30), allowNull: false, defaultValue: 'PENDING' },
        rejection_reason: { type: D.TEXT, allowNull: true }, reviewer_note: { type: D.TEXT, allowNull: true },
        reviewed_by_user_id: { type: D.BIGINT, allowNull: true }, reviewed_at: { type: D.DATE, allowNull: true },
        approved_payment_id: { type: D.BIGINT, allowNull: true }, duplicate_of_slip_id: { type: D.BIGINT, allowNull: true },
        acknowledgement_queued_at: { type: D.DATE, allowNull: true }, decision_acknowledgement_queued_at: { type: D.DATE, allowNull: true },
        deleted_at: { type: D.DATE, allowNull: true },
        created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
        }, queryOptions);
        await q.addIndex('payment_slips', ['whatsapp_message_id'], { unique: true, name: 'payment_slips_whatsapp_message_unique', transaction });
        for (const [fields, name] of [
          [['verification_status'], 'payment_slips_status_idx'], [['contact_id'], 'payment_slips_contact_idx'],
          [['student_id'], 'payment_slips_student_idx'], [['reference_number'], 'payment_slips_reference_idx'],
          [['file_hash'], 'payment_slips_file_hash_idx'], [['created_at'], 'payment_slips_created_idx']
        ]) await q.addIndex('payment_slips', fields, { name, transaction });
      }
      if (!(await exists(q, 'payment_slip_detection_jobs', transaction))) {
        await q.createTable('payment_slip_detection_jobs', {
        id: { type: D.BIGINT, autoIncrement: true, primaryKey: true }, message_id: { type: D.BIGINT, allowNull: false, unique: true },
        status: { type: D.STRING(30), allowNull: false, defaultValue: 'QUEUED' }, attempts: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
        max_attempts: { type: D.INTEGER, allowNull: false, defaultValue: 3 }, next_attempt_at: { type: D.DATE, allowNull: true },
        last_error: { type: D.TEXT, allowNull: true }, processed_at: { type: D.DATE, allowNull: true },
        created_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: D.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
        }, queryOptions);
        await q.addIndex('payment_slip_detection_jobs', ['status', 'next_attempt_at'], { name: 'payment_slip_jobs_due_idx', transaction });
      }
      for (const [code, name, description] of PERMISSIONS) {
        const [rows] = await q.sequelize.query('SELECT id FROM permissions WHERE code = :code', { replacements: { code }, transaction });
        if (!rows.length) await q.bulkInsert('permissions', [{ code, name, description, created_at: new Date(), updated_at: new Date() }], queryOptions);
      }
      const rolePermissionSchema = await q.describeTable('role_permissions', queryOptions);
      const [roles] = await q.sequelize.query("SELECT id, lower(name) AS name FROM roles WHERE lower(name) IN ('admin','manager','accountant','agent')", queryOptions);
      for (const role of roles) {
        const allowed = role.name === 'agent' ? ['payment-slips.mark'] : PERMISSIONS.map(([code]) => code);
        for (const code of allowed) {
          const [permission] = await q.sequelize.query('SELECT id FROM permissions WHERE code = :code', { replacements: { code }, transaction });
          if (!permission[0]) continue;
          const [linked] = await q.sequelize.query('SELECT role_id FROM role_permissions WHERE role_id = :roleId AND permission_id = :permissionId', { replacements: { roleId: role.id, permissionId: permission[0].id }, transaction });
          if (!linked.length) {
            const rolePermission = { role_id: role.id, permission_id: permission[0].id };
            if (rolePermissionSchema.granted_at) rolePermission.granted_at = new Date();
            await q.bulkInsert('role_permissions', [rolePermission], queryOptions);
          }
        }
      }
    };

    if (typeof q.sequelize.transaction === 'function') {
      return q.sequelize.transaction(migrate);
    }
    return migrate(undefined);
  },
  async down() { /* additive, data-retaining migration */ }
};
