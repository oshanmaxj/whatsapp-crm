const LOCK = 560056;
const name = '056_reminder_interactive_messages.js';

async function columns(q, table, definitions, transaction) {
  const current = await q.describeTable(table, { transaction });
  for (const [column, definition] of Object.entries(definitions)) {
    if (!current[column]) {
      console.log(`[${name}] add ${table}.${column}`);
      await q.addColumn(table, column, definition, { transaction });
    }
  }
}

module.exports.up = async (q, S) => {
  const transaction = await q.sequelize.transaction();
  try {
    await q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction });
    await columns(q, 'reminder_sequence_steps', {
      footer: { type: S.TEXT },
      media_config: { type: S.JSONB, allowNull: false, defaultValue: {} },
      interactive_config: { type: S.JSONB, allowNull: false, defaultValue: {} },
      fallback_variable_mapping: { type: S.JSONB, allowNull: false, defaultValue: {} }
    }, transaction);
    await columns(q, 'reminder_executions', {
      sequence_id: { type: S.BIGINT },
      message_type: { type: S.STRING(30) },
      media_record_id: { type: S.BIGINT },
      meta_media_id: { type: S.STRING(255) },
      template_id: { type: S.BIGINT },
      service_window_decision: { type: S.STRING(40) },
      button_configuration_snapshot: { type: S.JSONB, allowNull: false, defaultValue: {} },
      delivered_at: { type: S.DATE },
      read_at: { type: S.DATE },
      failed_at: { type: S.DATE }
    }, transaction);
    await q.changeColumn('reminder_executions', 'status', {
      type: S.STRING(50), allowNull: false, defaultValue: 'scheduled'
    }, { transaction });
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    error.migrationOperation = name;
    throw error;
  }
};

module.exports.down = async () => {};
