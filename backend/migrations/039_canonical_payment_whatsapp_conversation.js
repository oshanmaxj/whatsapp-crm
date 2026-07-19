async function columnExists(q, table, column, transaction) {
  const schema = await q.describeTable(table, { transaction }).catch(() => null);
  return Boolean(schema && schema[column]);
}

async function add(q, table, column, definition, transaction) {
  if (!await columnExists(q, table, column, transaction)) await q.addColumn(table, column, definition, { transaction });
}

module.exports = {
  async up(q, Sequelize) {
    const D = Sequelize.DataTypes;
    const migrate = async (transaction) => {
      await add(q, 'fee_installments', 'source_conversation_id', { type: D.BIGINT, allowNull: true }, transaction);
      await add(q, 'fee_installments', 'whatsapp_account_id', { type: D.BIGINT, allowNull: true }, transaction);
      await add(q, 'accounting_transactions', 'source_conversation_id', { type: D.BIGINT, allowNull: true }, transaction);
      await add(q, 'accounting_transactions', 'whatsapp_account_id', { type: D.BIGINT, allowNull: true }, transaction);
      await add(q, 'payment_receipts', 'conversation_id', { type: D.BIGINT, allowNull: true }, transaction);
      await add(q, 'payment_receipts', 'whatsapp_account_id', { type: D.BIGINT, allowNull: true }, transaction);
      await add(q, 'payment_receipt_jobs', 'conversation_id', { type: D.BIGINT, allowNull: true }, transaction);
      await add(q, 'payment_receipt_jobs', 'whatsapp_account_id', { type: D.BIGINT, allowNull: true }, transaction);
      await add(q, 'message_queue', 'conversation_id', { type: D.BIGINT, allowNull: true }, transaction);
      await add(q, 'message_queue', 'contact_id', { type: D.BIGINT, allowNull: true }, transaction);
      const [duplicates] = await q.sequelize.query(`
        SELECT contact_id, whatsapp_account_id
        FROM conversations
        WHERE whatsapp_account_id IS NOT NULL AND status IN ('open', 'pending') AND deleted_at IS NULL
        GROUP BY contact_id, whatsapp_account_id HAVING COUNT(*) > 1
      `, { transaction });
      if (!duplicates.length) {
        await q.sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_active_whatsapp_identity
          ON conversations (contact_id, whatsapp_account_id)
          WHERE whatsapp_account_id IS NOT NULL AND status IN ('open', 'pending') AND deleted_at IS NULL`, { transaction });
      }
    };
    return typeof q.sequelize.transaction === 'function' ? q.sequelize.transaction(migrate) : migrate(undefined);
  },
  async down() { /* context columns preserve financial and messaging history */ }
};
