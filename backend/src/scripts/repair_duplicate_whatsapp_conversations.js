require('dotenv').config();
const { QueryTypes } = require('sequelize');
const models = require('../models');

const REFERENCE_COLUMNS = [
  ['messages', 'conversation_id'], ['media', 'conversation_id'], ['payment_slips', 'conversation_id'],
  ['fee_installments', 'source_conversation_id'], ['accounting_transactions', 'source_conversation_id'],
  ['payment_receipts', 'conversation_id'], ['payment_receipt_jobs', 'conversation_id'],
  ['message_queue', 'conversation_id'], ['agent_commissions', 'conversation_id'],
  ['followups', 'conversation_id'], ['flow_runs', 'conversation_id'], ['conversation_notes', 'conversation_id'],
  ['conversation_assignment_history', 'conversation_id']
];

async function duplicateGroups(sequelize, transaction) {
  return sequelize.query(`
    SELECT contact_id AS "contactId", whatsapp_account_id AS "whatsappAccountId", array_agg(id ORDER BY id) AS ids
    FROM conversations
    WHERE whatsapp_account_id IS NOT NULL AND status IN ('open', 'pending') AND deleted_at IS NULL
    GROUP BY contact_id, whatsapp_account_id HAVING COUNT(*) > 1
    ORDER BY contact_id, whatsapp_account_id
  `, { type: QueryTypes.SELECT, transaction });
}

async function tableColumns(sequelize, table, transaction) {
  const rows = await sequelize.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = :table
  `, { replacements: { table }, type: QueryTypes.SELECT, transaction });
  return new Set(rows.map((row) => row.column_name));
}

async function inspectGroup(sequelize, group, transaction, lock = false) {
  if (lock) {
    await sequelize.query(`
      SELECT id FROM conversations
      WHERE contact_id = :contactId AND whatsapp_account_id = :whatsappAccountId
        AND status IN ('open', 'pending') AND deleted_at IS NULL
      ORDER BY id FOR UPDATE
    `, { replacements: group, type: QueryTypes.SELECT, transaction });
  }
  const rows = await sequelize.query(`
    SELECT c.id, c.status, c.assigned_user_id AS "assignedUserId", c.assigned_role_id AS "assignedRoleId",
      c.last_message_at AS "lastMessageAt", c.updated_at AS "updatedAt",
      COUNT(m.id)::int AS "messageCount",
      COUNT(m.id) FILTER (WHERE m.direction = 'inbound')::int AS "inboundCount"
    FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
    WHERE c.contact_id = :contactId AND c.whatsapp_account_id = :whatsappAccountId
      AND c.status IN ('open', 'pending') AND c.deleted_at IS NULL
    GROUP BY c.id
    ORDER BY "inboundCount" DESC, c.last_message_at DESC NULLS LAST, c.updated_at DESC, c.id ASC
  `, { replacements: group, type: QueryTypes.SELECT, transaction });
  const assignedUsers = [...new Set(rows.map((row) => row.assignedUserId).filter(Boolean).map(String))];
  const assignedRoles = [...new Set(rows.map((row) => row.assignedRoleId).filter(Boolean).map(String))];
  return {
    ...group, conversations: rows, canonicalId: rows[0]?.id || null,
    duplicateIds: rows.slice(1).map((row) => row.id),
    ambiguous: assignedUsers.length > 1 || assignedRoles.length > 1,
    assignmentSummary: { assignedUsers, assignedRoles }
  };
}

async function moveReferences(sequelize, fromId, toId, transaction) {
  for (const [table, column] of REFERENCE_COLUMNS) {
    const columns = await tableColumns(sequelize, table, transaction);
    if (!columns.has(column)) continue;
    await sequelize.query(`UPDATE "${table}" SET "${column}" = :toId WHERE "${column}" = :fromId`, {
      replacements: { fromId, toId }, transaction
    });
  }
  const labelColumns = await tableColumns(sequelize, 'conversation_labels', transaction);
  if (labelColumns.has('conversation_id')) {
    await sequelize.query(`
      INSERT INTO conversation_labels (conversation_id, label_id)
      SELECT :toId, label_id FROM conversation_labels WHERE conversation_id = :fromId
      ON CONFLICT DO NOTHING
    `, { replacements: { fromId, toId }, transaction });
    await sequelize.query('DELETE FROM conversation_labels WHERE conversation_id = :fromId', { replacements: { fromId }, transaction });
  }
}

async function repair({ sequelize = models.sequelize, apply = false, output = console } = {}) {
  const groups = await duplicateGroups(sequelize);
  const report = [];
  for (const group of groups) report.push(await inspectGroup(sequelize, group));
  output.log(JSON.stringify({ mode: apply ? 'apply' : 'report', groups: report }, null, 2));
  if (!apply) return { mode: 'report', groups: report, repaired: 0, skipped: 0 };

  let repaired = 0;
  let skipped = 0;
  for (const group of groups) {
    await sequelize.transaction(async (transaction) => {
      const current = await inspectGroup(sequelize, group, transaction, true);
      if (current.duplicateIds.length === 0) return;
      if (current.ambiguous) {
        skipped += 1;
        output.warn(`Skipped contact ${group.contactId}/account ${group.whatsappAccountId}: conflicting assignments.`);
        return;
      }
      const canonical = current.conversations[0];
      const assigned = current.conversations.find((row) => row.assignedUserId || row.assignedRoleId);
      if (!canonical.assignedUserId && !canonical.assignedRoleId && assigned) {
        await sequelize.query(`UPDATE conversations SET assigned_user_id = :userId, assigned_role_id = :roleId, updated_at = NOW() WHERE id = :id`, {
          replacements: { id: canonical.id, userId: assigned.assignedUserId || null, roleId: assigned.assignedRoleId || null }, transaction
        });
      }
      for (const duplicateId of current.duplicateIds) {
        await moveReferences(sequelize, duplicateId, canonical.id, transaction);
        await sequelize.query(`UPDATE conversations SET status = 'archived', updated_at = NOW() WHERE id = :duplicateId`, {
          replacements: { duplicateId }, transaction
        });
      }
      await sequelize.query(`
        UPDATE conversations c SET
          last_message = latest.text,
          last_message_at = latest.created_at,
          updated_at = NOW()
        FROM (SELECT text, created_at FROM messages WHERE conversation_id = :id ORDER BY created_at DESC, id DESC LIMIT 1) latest
        WHERE c.id = :id
      `, { replacements: { id: canonical.id }, transaction });
      repaired += current.duplicateIds.length;
    });
  }
  const remaining = await duplicateGroups(sequelize);
  if (remaining.length === 0) {
    await sequelize.query(`CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_active_whatsapp_identity
      ON conversations (contact_id, whatsapp_account_id)
      WHERE whatsapp_account_id IS NOT NULL AND status IN ('open', 'pending') AND deleted_at IS NULL`);
  }
  return { mode: 'apply', groups: report, repaired, skipped, remaining: remaining.length };
}

if (require.main === module) {
  repair({ apply: process.argv.includes('--apply') })
    .then((result) => { console.log(JSON.stringify(result)); return models.sequelize.close(); })
    .catch(async (error) => { console.error(error); await models.sequelize.close(); process.exitCode = 1; });
}

module.exports = { repair, duplicateGroups, inspectGroup, REFERENCE_COLUMNS };
