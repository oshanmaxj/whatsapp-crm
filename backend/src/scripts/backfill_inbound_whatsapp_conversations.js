require('dotenv').config();

const { QueryTypes } = require('sequelize');
const sequelize = require('../config/database');

const ORPHAN_WHERE = `
  m.direction = 'inbound'
  AND m.channel = 'whatsapp'
  AND m.conversation_id IS NULL
  AND m.deleted_at IS NULL
`;

async function inspectOrphans(transaction) {
  return sequelize.query(`
    SELECT
      m.id AS message_id,
      m.contact_id,
      m.whatsapp_account_id,
      COUNT(c.id)::integer AS candidate_count,
      ARRAY_REMOVE(ARRAY_AGG(c.id ORDER BY c.id), NULL) AS candidate_conversation_ids
    FROM messages m
    LEFT JOIN conversations c
      ON c.contact_id = m.contact_id
      AND c.whatsapp_account_id = m.whatsapp_account_id
      AND c.deleted_at IS NULL
    WHERE ${ORPHAN_WHERE}
    GROUP BY m.id, m.contact_id, m.whatsapp_account_id
    ORDER BY m.id
  `, { type: QueryTypes.SELECT, transaction });
}

async function applyUnambiguousBackfill(transaction) {
  const [, metadata] = await sequelize.query(`
    WITH unambiguous AS (
      SELECT m.id AS message_id, MIN(c.id) AS conversation_id
      FROM messages m
      JOIN conversations c
        ON c.contact_id = m.contact_id
        AND c.whatsapp_account_id = m.whatsapp_account_id
        AND c.deleted_at IS NULL
      WHERE ${ORPHAN_WHERE}
      GROUP BY m.id
      HAVING COUNT(c.id) = 1
    )
    UPDATE messages AS m
    SET conversation_id = u.conversation_id,
        updated_at = NOW()
    FROM unambiguous AS u
    WHERE m.id = u.message_id
      AND m.conversation_id IS NULL
    RETURNING m.id
  `, { transaction });
  return metadata?.rowCount || 0;
}

async function run({ apply = false } = {}) {
  await sequelize.authenticate();
  const report = await sequelize.transaction(async (transaction) => {
    const rows = await inspectOrphans(transaction);
    const unambiguous = rows.filter((row) => row.candidate_count === 1);
    const ambiguous = rows.filter((row) => row.candidate_count > 1);
    const unmatched = rows.filter((row) => row.candidate_count === 0);
    const updated = apply ? await applyUnambiguousBackfill(transaction) : 0;
    return { rows, unambiguous, ambiguous, unmatched, updated };
  });

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'report',
    orphanCount: report.rows.length,
    unambiguousCount: report.unambiguous.length,
    updatedCount: report.updated,
    ambiguous: report.ambiguous.map((row) => ({
      messageId: row.message_id,
      contactId: row.contact_id,
      whatsappAccountId: row.whatsapp_account_id,
      candidateConversationIds: row.candidate_conversation_ids
    })),
    unmatched: report.unmatched.map((row) => ({
      messageId: row.message_id,
      contactId: row.contact_id,
      whatsappAccountId: row.whatsapp_account_id
    }))
  }, null, 2));
  return report;
}

if (require.main === module) {
  run({ apply: process.argv.includes('--apply') })
    .then(() => sequelize.close())
    .catch(async (error) => {
      console.error('Inbound WhatsApp conversation backfill failed:', error.message);
      await sequelize.close().catch(() => {});
      process.exitCode = 1;
    });
}

module.exports = { run, inspectOrphans, applyUnambiguousBackfill };
