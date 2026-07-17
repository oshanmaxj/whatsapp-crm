require('dotenv').config();

const { QueryTypes } = require('sequelize');
const sequelize = require('../config/database');

const apply = process.argv.includes('--apply');

function quote(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

async function referencingColumns(transaction) {
  return sequelize.query(`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND column_name = 'conversation_id'
      AND table_name <> 'conversations'
  `, { type: QueryTypes.SELECT, transaction });
}

async function duplicateGroups(transaction) {
  return sequelize.query(`
    SELECT COALESCE(whatsapp_account_id, 0) AS account_key,
           normalized_phone,
           array_agg(id ORDER BY
             CASE WHEN status = 'open' THEN 0 WHEN status = 'pending' THEN 1 ELSE 2 END,
             created_at ASC,
             id ASC
           ) AS conversation_ids
    FROM conversations
    WHERE deleted_at IS NULL AND normalized_phone IS NOT NULL
    GROUP BY COALESCE(whatsapp_account_id, 0), normalized_phone
    HAVING COUNT(*) > 1
    ORDER BY normalized_phone
  `, { type: QueryTypes.SELECT, transaction });
}

async function repair() {
  await sequelize.authenticate();
  const summary = {
    mode: apply ? 'apply' : 'dry-run',
    duplicateGroupsFound: 0,
    conversationsMerged: 0,
    messagesMoved: 0,
    dependentRecordsMoved: 0,
    recordsArchived: 0,
    groups: [],
    errors: []
  };

  const transaction = await sequelize.transaction();
  try {
    const references = await referencingColumns(transaction);
    const groups = await duplicateGroups(transaction);
    summary.duplicateGroupsFound = groups.length;

    for (const group of groups) {
      const ids = group.conversation_ids.map(Number);
      const canonicalConversationId = ids[0];
      const mergedConversationIds = ids.slice(1);
      const detail = {
        canonicalConversationId,
        mergedConversationIds,
        normalizedPhone: group.normalized_phone,
        whatsappAccountId: Number(group.account_key) || null
      };
      summary.groups.push(detail);
      summary.conversationsMerged += mergedConversationIds.length;
      if (!apply) continue;

      await sequelize.query('SELECT id FROM conversations WHERE id IN (:ids) FOR UPDATE', {
        replacements: { ids }, transaction
      });

      const candidates = await sequelize.query(`
        SELECT assigned_user_id, assigned_role_id, lead_id, last_message, last_message_at, updated_at
        FROM conversations
        WHERE id IN (:ids)
        ORDER BY updated_at DESC NULLS LAST, id DESC
      `, { replacements: { ids }, type: QueryTypes.SELECT, transaction });
      const mostRecent = candidates[0] || {};
      const latestValue = (field) => candidates.find((item) => item[field] != null)?.[field] ?? null;
      await sequelize.query(`
        UPDATE conversations
        SET assigned_user_id = COALESCE(:assignedUserId, assigned_user_id),
            assigned_role_id = COALESCE(:assignedRoleId, assigned_role_id),
            lead_id = COALESCE(:leadId, lead_id),
            last_message = COALESCE(:lastMessage, last_message),
            last_message_at = GREATEST(last_message_at, :lastMessageAt),
            updated_at = GREATEST(updated_at, :updatedAt)
        WHERE id = :canonicalId
      `, {
        replacements: {
          canonicalId: canonicalConversationId,
          assignedUserId: latestValue('assigned_user_id'),
          assignedRoleId: latestValue('assigned_role_id'),
          leadId: latestValue('lead_id'),
          lastMessage: mostRecent.last_message || null,
          lastMessageAt: latestValue('last_message_at'),
          updatedAt: latestValue('updated_at')
        }, transaction
      });

      for (const reference of references) {
        const table = reference.table_name;
        const column = reference.column_name;
        if (table === 'conversation_labels') {
          await sequelize.query(`
            INSERT INTO conversation_labels (conversation_id, label_id, assigned_at)
            SELECT :canonicalId, label_id, MIN(assigned_at)
            FROM conversation_labels
            WHERE conversation_id IN (:mergedIds)
            GROUP BY label_id
            ON CONFLICT (conversation_id, label_id) DO NOTHING
          `, { replacements: { canonicalId: canonicalConversationId, mergedIds: mergedConversationIds }, transaction });
          const [, metadata] = await sequelize.query(
            'DELETE FROM conversation_labels WHERE conversation_id IN (:mergedIds)',
            { replacements: { mergedIds: mergedConversationIds }, transaction }
          );
          summary.dependentRecordsMoved += Number(metadata?.rowCount || 0);
          continue;
        }
        const [result, metadata] = await sequelize.query(
          `UPDATE ${quote(reference.table_schema)}.${quote(table)} SET ${quote(column)} = :canonicalId WHERE ${quote(column)} IN (:mergedIds)`,
          { replacements: { canonicalId: canonicalConversationId, mergedIds: mergedConversationIds }, transaction }
        );
        const moved = Number(metadata?.rowCount ?? result?.rowCount ?? 0);
        summary.dependentRecordsMoved += moved;
        if (table === 'messages') summary.messagesMoved += moved;
      }

      const [, archiveMetadata] = await sequelize.query(`
        UPDATE conversations
        SET status = 'archived', deleted_at = NOW(), updated_at = NOW()
        WHERE id IN (:mergedIds) AND deleted_at IS NULL
      `, { replacements: { mergedIds: mergedConversationIds }, transaction });
      summary.recordsArchived += Number(archiveMetadata?.rowCount || 0);
    }

    if (apply) {
      await sequelize.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS conversations_account_normalized_phone_unique
        ON conversations (COALESCE(whatsapp_account_id, 0), normalized_phone)
        WHERE deleted_at IS NULL AND normalized_phone IS NOT NULL
      `, { transaction });
      await transaction.commit();
    } else {
      await transaction.rollback();
    }
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    summary.errors.push({ message: error.message, code: error.original?.code || error.code || null });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    throw error;
  } finally {
    await sequelize.close();
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

repair().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
