'use strict';

const LOCK = 570073;

// Additive-only: nullable referral (72-hour Free Entry Point) and pricing
// metadata columns on `messages`. Every existing row gets NULL for all of
// these — the dashboard and window-calculation code treat NULL as
// Unknown/Unverified rather than inferring eligibility, so no historical
// message is reclassified by this migration. Populated going forward only,
// by whatsapp.service.js's inbound-message and status-webhook handlers,
// from fields Meta already sends on those webhooks (message.referral,
// status.pricing) that were previously only kept inside the existing
// unstructured rawPayload JSON blob, never in a queryable column.
// Same self-lock-avoidance rationale as migration 066: every schema-
// inspection call below passes { transaction } to stay on the same
// connection that holds this migration's own advisory lock.
async function tableExists(q, name, transaction) {
  return (await q.showAllTables({ transaction })).some(value => String(value?.tableName || value?.table_name || value).toLowerCase() === name);
}

async function addColumnIfMissing(q, table, column, definition, transaction) {
  const described = await q.describeTable(table, { transaction });
  if (described[column]) return;
  await q.addColumn(table, column, definition, { transaction });
}

async function addIndexIfMissing(q, table, fields, options, transaction) {
  const [existing] = await q.sequelize.query(
    'SELECT indexname FROM pg_indexes WHERE tablename = :table AND indexname = :name',
    { replacements: { table, name: options.name }, transaction }
  );
  if (existing.length) return;
  await q.addIndex(table, fields, { ...options, transaction });
}

module.exports = {
  async up(q, Sequelize) {
    const D = Sequelize.DataTypes;
    await q.sequelize.transaction(async transaction => {
      await q.sequelize.query("SET LOCAL lock_timeout = '10s'", { transaction });
      await q.sequelize.query("SET LOCAL statement_timeout = '120s'", { transaction });
      await q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction });

      if (!await tableExists(q, 'messages', transaction)) return; // defensive: nothing to extend on a database without the messages table yet

      // Free Entry Point (72-hour window) referral evidence — present only
      // on an inbound message that genuinely arrived via a Click-to-WhatsApp
      // ad or a Facebook/Instagram Page "Message" CTA (Meta's `referral`
      // object on that one message). Absent on every ordinary message.
      await addColumnIfMissing(q, 'messages', 'referral_source_type', { type: D.STRING(50), allowNull: true }, transaction);
      await addColumnIfMissing(q, 'messages', 'referral_source_id', { type: D.STRING(255), allowNull: true }, transaction);
      await addColumnIfMissing(q, 'messages', 'referral_source_url', { type: D.STRING(1024), allowNull: true }, transaction);
      await addColumnIfMissing(q, 'messages', 'referral_headline', { type: D.TEXT, allowNull: true }, transaction);
      await addColumnIfMissing(q, 'messages', 'ctwa_clid', { type: D.STRING(255), allowNull: true }, transaction);

      // Pricing/billing metadata from Meta's status webhook `pricing` object
      // (billable / pricing_model: "PMP" post-July-2025 or legacy "CBP" /
      // category: marketing|utility|authentication|service). NULL means the
      // status webhook for this message either hasn't arrived yet or never
      // carried a pricing object (e.g. an inbound message, which is never
      // billed) — never assumed to mean "free".
      await addColumnIfMissing(q, 'messages', 'pricing_category', { type: D.STRING(50), allowNull: true }, transaction);
      await addColumnIfMissing(q, 'messages', 'pricing_model', { type: D.STRING(20), allowNull: true }, transaction);
      await addColumnIfMissing(q, 'messages', 'pricing_billable', { type: D.BOOLEAN, allowNull: true }, transaction);

      // Supports "find the latest referral-bearing inbound message for this
      // conversation" (the 72-hour window's entry-event lookup) without a
      // full table scan. A plain (not partial) composite index — kept
      // simple and unambiguous rather than relying on partial-index WHERE
      // syntax this migration has no local database available to verify
      // against; the query planner still uses it effectively since
      // referral_source_type is NULL on the large majority of rows.
      await addIndexIfMissing(
        q, 'messages', ['conversation_id', 'referral_source_type', 'created_at'],
        { name: 'messages_conversation_referral_idx' },
        transaction
      );
    });
  },

  async down() { /* Additive migration: the nullable columns/index are safe to retain; rollback is application-first. */ }
};
