'use strict';

const LOCK = 570066;

// Additive-only: a nullable `channels` column on `flows` that, when set,
// lists every channel the flow is enabled for (e.g. ['whatsapp',
// 'facebook_messenger']). Every existing flow gets NULL here, and the
// application layer (flowTriggerMatcher.service.js) falls back to the
// legacy single `channel` column whenever `channels` is null/empty — so no
// existing flow's trigger-matching behavior changes as a result of this
// migration. See the same self-lock-avoidance rationale as migration 065:
// all schema-inspection calls below pass { transaction } to stay on the
// same connection that holds this migration's own lock.
async function tableExists(q, name, transaction) {
  return (await q.showAllTables({ transaction })).some(value => String(value?.tableName || value?.table_name || value).toLowerCase() === name);
}

async function addColumnIfMissing(q, table, column, definition, transaction) {
  const described = await q.describeTable(table, { transaction });
  if (described[column]) return;
  await q.addColumn(table, column, definition, { transaction });
}

module.exports = {
  async up(q, Sequelize) {
    const D = Sequelize.DataTypes;
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query("SET LOCAL lock_timeout = '10s'", { transaction });
      await q.sequelize.query("SET LOCAL statement_timeout = '120s'", { transaction });
      await q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction });

      if (!await tableExists(q, 'flows', transaction)) return; // defensive: nothing to extend on a database without the flows table yet

      await addColumnIfMissing(q, 'flows', 'channels', { type: D.JSON, allowNull: true, defaultValue: null }, transaction);
    });
  },

  async down() { /* Additive migration: the nullable column is safe to retain; rollback is application-first. */ }
};
