require('dotenv').config();
const sequelize = require('../config/database');

const TABLES = [
  'reminder_sequences',
  'reminder_sequence_steps',
  'reminder_subscriptions',
  'reminder_executions',
  'scheduled_reminders',
  'ai_providers'
];

async function inspect() {
  await sequelize.authenticate();
  const [objects] = await sequelize.query(`
    SELECT c.relname AS "table", c.relkind AS "kind"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relname IN (:tables)
    ORDER BY c.relname
  `, { replacements: { tables: TABLES } });
  const [columns] = await sequelize.query(`
    SELECT table_name AS "table", column_name AS "column", data_type AS "dataType", udt_name AS "udtName", is_nullable AS "nullable"
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name IN (:tables)
    ORDER BY table_name, ordinal_position
  `, { replacements: { tables: TABLES } });
  const [constraints] = await sequelize.query(`
    SELECT conrelid::regclass::text AS "table", conname AS "constraint", contype AS "type", pg_get_constraintdef(oid) AS "definition"
    FROM pg_constraint
    WHERE conrelid::regclass::text IN (:tables)
    ORDER BY conrelid::regclass::text, conname
  `, { replacements: { tables: TABLES } });
  const [indexes] = await sequelize.query(`
    SELECT tablename AS "table", indexname AS "index", indexdef AS "definition"
    FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename IN (:tables)
    ORDER BY tablename, indexname
  `, { replacements: { tables: TABLES } });
  const [statusEnum] = await sequelize.query(`
    SELECT t.typname AS "type", e.enumlabel AS "value"
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE c.relname = 'reminder_subscriptions' AND a.attname = 'status' AND a.attnum > 0
    ORDER BY e.enumsortorder
  `);
  const tableNames = new Set(objects.map(row => row.table));
  let activeSubscriptionDuplicates = [];
  if (tableNames.has('reminder_subscriptions') && ['sequence_id', 'conversation_id', 'status'].every(name => columns.some(row => row.table === 'reminder_subscriptions' && row.column === name))) {
    [activeSubscriptionDuplicates] = await sequelize.query(`
      SELECT sequence_id AS "sequenceId", conversation_id AS "conversationId", COUNT(*)::integer AS "count", ARRAY_AGG(id ORDER BY id) AS "subscriptionIds"
      FROM reminder_subscriptions
      WHERE status::text IN ('active', 'paused')
      GROUP BY sequence_id, conversation_id
      HAVING COUNT(*) > 1
      ORDER BY sequence_id, conversation_id
    `);
  }
  console.log(JSON.stringify({
    migration: '046_reminder_sequences_ai_providers.js',
    readOnly: true,
    objects,
    missingObjects: TABLES.filter(name => !tableNames.has(name)),
    columns,
    constraints,
    indexes,
    statusEnum,
    activeSubscriptionDuplicates
  }, null, 2));
}

inspect()
  .then(() => sequelize.close())
  .catch(async error => {
    const original = error.original || error.parent || error;
    console.error(JSON.stringify({
      message: original.message || error.message,
      sqlState: original.code || null,
      sql: original.sql || error.sql || null,
      table: original.table || null,
      column: original.column || null,
      constraint: original.constraint || null
    }, null, 2));
    await sequelize.close().catch(() => {});
    process.exitCode = 1;
  });
