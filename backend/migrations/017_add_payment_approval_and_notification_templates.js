const DEFAULT_TEMPLATES = [
  {
    key: 'payment_success',
    title: 'Payment Success Message',
    body: 'Hi {{student.name}}, payment of Rs. {{payment.amount}} was received successfully on {{payment.date}} via {{payment.method}}. Thank you. - {{company.name}}'
  },
  {
    key: 'payment_reminder',
    title: 'Payment Reminder Message',
    body: 'Hi {{student.name}}, this is a reminder that installment {{installment.no}} of Rs. {{fee.amount}} for {{course.name}} is due on {{installment.due_date}}.'
  },
  {
    key: 'class_reminder',
    title: 'Class Reminder / Zoom Link Message',
    body: 'Hi {{student.name}}, your {{course.name}} class is on {{class.date}} at {{class.time}}. Join: {{zoom.link}}'
  },
  {
    key: 'birthday_wish',
    title: 'Birthday Wish Message',
    body: 'Happy Birthday {{student.name}}! Wishing you a wonderful year ahead. - {{company.name}}'
  },
  {
    key: 'assignment_notification',
    title: 'Assignment Notification Message',
    body: 'Hi {{agent.name}}, a new customer conversation has been assigned to you. Please check the CRM.'
  },
  {
    key: 'registration_success',
    title: 'Registration Success Message',
    body: 'Hi {{student.name}}, your registration for {{course.name}} has been completed successfully. Welcome to {{company.name}}!'
  }
];

async function tableExists(queryInterface, tableName) {
  return Boolean(await queryInterface.describeTable(tableName).catch(() => null));
}

async function addColumn(queryInterface, tableName, columnName, definition) {
  const description = await queryInterface.describeTable(tableName);
  if (!description[columnName]) await queryInterface.addColumn(tableName, columnName, definition);
}

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const dialect = queryInterface.sequelize.getDialect();

    if (dialect === 'postgres') {
      for (const value of ['pending_confirmation', 'confirmed', 'rejected', 'reversed']) {
        await queryInterface.sequelize.query(
          `ALTER TYPE "enum_fee_installments_status" ADD VALUE IF NOT EXISTS '${value}'`
        ).catch(() => null);
      }
    } else if (dialect === 'mysql' || dialect === 'mariadb') {
      await queryInterface.sequelize.query(`
        ALTER TABLE fee_installments MODIFY COLUMN status
        ENUM('pending','due_soon','due_today','paid','partially_paid','overdue','pending_confirmation','confirmed','rejected','cancelled','reversed')
        NOT NULL DEFAULT 'pending'
      `);
    }

    await addColumn(queryInterface, 'fee_installments', 'pending_payment_amount', { type: DataTypes.DECIMAL(15, 2), allowNull: true });
    await addColumn(queryInterface, 'fee_installments', 'confirmed_by', { type: DataTypes.BIGINT.UNSIGNED, allowNull: true });
    await addColumn(queryInterface, 'fee_installments', 'confirmed_at', { type: DataTypes.DATE, allowNull: true });
    await addColumn(queryInterface, 'fee_installments', 'accounting_transaction_id', { type: DataTypes.BIGINT, allowNull: true });
    await addColumn(queryInterface, 'fee_installments', 'reversal_accounting_transaction_id', { type: DataTypes.BIGINT, allowNull: true });
    await addColumn(queryInterface, 'fee_installments', 'rejected_by', { type: DataTypes.BIGINT.UNSIGNED, allowNull: true });
    await addColumn(queryInterface, 'fee_installments', 'rejected_at', { type: DataTypes.DATE, allowNull: true });
    await addColumn(queryInterface, 'fee_installments', 'rejection_reason', { type: DataTypes.TEXT, allowNull: true });

    const indexes = await queryInterface.showIndex('fee_installments').catch(() => []);
    if (!indexes.some((index) => index.name === 'fee_installments_accounting_transaction_unique')) {
      await queryInterface.addIndex('fee_installments', ['accounting_transaction_id'], {
        name: 'fee_installments_accounting_transaction_unique',
        unique: true
      });
    }
    if (!indexes.some((index) => index.name === 'fee_installments_reversal_accounting_transaction_unique')) {
      await queryInterface.addIndex('fee_installments', ['reversal_accounting_transaction_id'], {
        name: 'fee_installments_reversal_accounting_transaction_unique',
        unique: true
      });
    }

    if (!await tableExists(queryInterface, 'notification_message_templates')) {
      await queryInterface.createTable('notification_message_templates', {
        id: { type: DataTypes.BIGINT, autoIncrement: true, primaryKey: true },
        key: { type: DataTypes.STRING(100), allowNull: false, unique: true },
        title: { type: DataTypes.STRING(180), allowNull: false },
        channel: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'whatsapp' },
        body: { type: DataTypes.TEXT, allowNull: false },
        is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        updated_at: { type: DataTypes.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') }
      });
      await queryInterface.addIndex('notification_message_templates', ['channel', 'is_active'], {
        name: 'notification_message_templates_channel_active_idx'
      });
    }

    for (const template of DEFAULT_TEMPLATES) {
      const [rows] = await queryInterface.sequelize.query(
        'SELECT id FROM notification_message_templates WHERE key = :key',
        { replacements: { key: template.key } }
      );
      if (!rows.length) {
        await queryInterface.bulkInsert('notification_message_templates', [{
          ...template,
          channel: 'whatsapp',
          is_active: true,
          created_at: new Date(),
          updated_at: new Date()
        }]);
      }
    }

    const confirmationPermissions = [
      ['fees.confirm_payment', 'Fees Confirm Payment', 'Confirm or reject student fee payments'],
      ['accounting.confirm_income', 'Accounting Confirm Income', 'Confirm fee payments and create accounting income']
    ];
    for (const [code, name, description] of confirmationPermissions) {
      const [existing] = await queryInterface.sequelize.query(
        'SELECT id FROM permissions WHERE code = :code',
        { replacements: { code } }
      );
      if (!existing.length) {
        await queryInterface.bulkInsert('permissions', [{
          code, name, description, created_at: new Date(), updated_at: new Date()
        }]);
      }
      const [permissionRows] = await queryInterface.sequelize.query(
        'SELECT id FROM permissions WHERE code = :code',
        { replacements: { code } }
      );
      const [roleRows] = await queryInterface.sequelize.query(
        'SELECT id FROM roles WHERE LOWER(name) IN (:roles) AND deleted_at IS NULL',
        { replacements: { roles: ['admin', 'manager', 'accountant'] } }
      );
      for (const role of roleRows) {
        const [mapping] = await queryInterface.sequelize.query(
          'SELECT role_id FROM role_permissions WHERE role_id = :roleId AND permission_id = :permissionId',
          { replacements: { roleId: role.id, permissionId: permissionRows[0].id } }
        );
        if (!mapping.length) {
          await queryInterface.bulkInsert('role_permissions', [{
            role_id: role.id,
            permission_id: permissionRows[0].id,
            granted_at: new Date()
          }]);
        }
      }
    }
  },

  async down() {
    // Payment and message history are intentionally retained.
  }
};
