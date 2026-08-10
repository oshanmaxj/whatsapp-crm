const { QueryTypes } = require('sequelize');
const LOCK = 570063;
const MIGRATION = '063_campaign_delivery_recovery.js';

const REQUIRED_TABLES = ['message_queue', 'campaign_recipients', 'campaigns'];
const REQUIRED_BASE_COLUMNS = {
  message_queue: ['id', 'status', 'scheduled_at', 'processed_at', 'attempts', 'last_error', 'created_at', 'updated_at'],
  campaign_recipients: ['id', 'campaign_id', 'status', 'external_message_id'],
  campaigns: ['id', 'status']
};
const NEW_COLUMNS = [
  ['message_queue', 'claimed_at', 'TIMESTAMPTZ', ['timestamp with time zone']],
  ['message_queue', 'locked_at', 'TIMESTAMPTZ', ['timestamp with time zone']],
  ['message_queue', 'worker_id', 'VARCHAR(160)', ['character varying']],
  ['message_queue', 'error_details', 'JSONB', ['jsonb']],
  ['message_queue', 'next_attempt_at', 'TIMESTAMPTZ', ['timestamp with time zone']],
  ['message_queue', 'external_message_id', 'VARCHAR(255)', ['character varying']],
  ['message_queue', 'campaign_id', 'BIGINT', ['bigint']],
  ['message_queue', 'campaign_recipient_id', 'BIGINT', ['bigint']],
  ['campaign_recipients', 'failed_at', 'TIMESTAMPTZ', ['timestamp with time zone']],
  ['campaign_recipients', 'error_details', 'JSONB', ['jsonb']],
  ['campaigns', 'started_at', 'TIMESTAMPTZ', ['timestamp with time zone']],
  ['campaigns', 'last_progress_at', 'TIMESTAMPTZ', ['timestamp with time zone']],
  ['campaigns', 'completed_at', 'TIMESTAMPTZ', ['timestamp with time zone']],
  ['campaigns', 'last_error', 'TEXT', ['text']],
  ['campaigns', 'total_recipients', 'INTEGER NOT NULL DEFAULT 0', ['integer']]
];

function operation(name, fn) {
  console.log(`[${MIGRATION}] ${name}`);
  return Promise.resolve().then(fn).catch((error) => {
    error.migrationOperation = name;
    throw error;
  });
}

async function tableNames(q, transaction) {
  const rows = await q.sequelize.query(`SELECT
      to_regclass('message_queue') AS message_queue,
      to_regclass('campaign_recipients') AS campaign_recipients,
      to_regclass('campaigns') AS campaigns`, {
    type: QueryTypes.SELECT, transaction
  });
  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] || typeof rows[0] !== 'object') {
    throw Object.assign(new Error('Unexpected result shape while resolving required campaign tables'), { code: 'MIGRATION_RESULT_SHAPE_INVALID' });
  }
  const row = rows[0];
  return new Set(REQUIRED_TABLES.filter(name => row[name] !== null && row[name] !== undefined));
}

async function column(q, table, name, transaction) {
  const [rows] = await q.sequelize.query(`SELECT data_type,character_maximum_length,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name=:table AND column_name=:name`, {
    replacements: { table, name }, transaction
  });
  return rows[0] || null;
}

async function index(q, name, transaction) {
  const [rows] = await q.sequelize.query(`SELECT indexdef FROM pg_indexes
    WHERE schemaname=current_schema() AND indexname=:name`, {
    replacements: { name }, transaction
  });
  return rows[0] || null;
}

async function addOrValidateColumn(q, table, name, definition, expectedTypes, transaction) {
  const existing = await column(q, table, name, transaction);
  if (existing) {
    if (!expectedTypes.includes(existing.data_type)) {
      throw Object.assign(new Error(`${table}.${name} has incompatible type ${existing.data_type}; expected ${expectedTypes.join(' or ')}`), { code: 'MIGRATION_SCHEMA_MISMATCH' });
    }
    if (name === 'worker_id' && existing.character_maximum_length != null && Number(existing.character_maximum_length) < 160) {
      throw Object.assign(new Error(`${table}.${name} is shorter than VARCHAR(160)`), { code: 'MIGRATION_SCHEMA_MISMATCH' });
    }
    console.log(`[${MIGRATION}] skip existing column ${table}.${name}`);
    return;
  }
  await q.sequelize.query(`ALTER TABLE "${table}" ADD COLUMN "${name}" ${definition}`, { transaction });
}

function classifyDuplicateGroup(rows) {
  const mappedIds = [...new Set(rows.map(row => row.recipient_queue_id).filter(value => value !== null && value !== undefined).map(String))];
  if (mappedIds.length !== 1) return { classification: mappedIds.length ? 'manual_review_conflicting_canonical_mappings' : 'manual_review_missing_canonical_mapping', ambiguous: true };
  const canonical = rows.find(row => String(row.id) === mappedIds[0]);
  if (!canonical) return { classification: 'manual_review_canonical_outside_duplicate_group', ambiguous: true };
  if (canonical.status === 'cancelled') return { classification: 'manual_review_canonical_is_cancelled', ambiguous: true };
  const liveRows = rows.filter(row => row.status !== 'cancelled');
  const liveExternalIds = [...new Set(liveRows.map(row => row.external_message_id).filter(Boolean))];
  if (liveExternalIds.length > 1) return { classification: 'manual_review_conflicting_live_external_ids', ambiguous: true };
  const supersededIds = liveRows.filter(row => String(row.id) !== mappedIds[0]).map(row => row.id);
  return {
    classification: supersededIds.length ? 'canonical_mapping_with_unresolved_live_duplicates' : 'canonical_mapping_already_resolved',
    ambiguous: false, canonicalId: canonical.id, supersededIds
  };
}

module.exports.up = async (q) => {
  const transaction = await q.sequelize.transaction();
  try {
    await operation('set bounded lock timeout', () => q.sequelize.query("SET LOCAL lock_timeout = '10s'", { transaction }));
    await operation('set bounded statement timeout', () => q.sequelize.query("SET LOCAL statement_timeout = '120s'", { transaction }));
    await operation('acquire migration advisory lock', () => q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction }));

    const tables = await operation('inspect required tables', () => tableNames(q, transaction));
    const missingTables = REQUIRED_TABLES.filter(name => !tables.has(name));
    if (missingTables.length) throw Object.assign(new Error(`Required tables are missing: ${missingTables.join(', ')}`), { code: 'MIGRATION_SCHEMA_MISMATCH', migrationOperation: 'validate required tables' });

    await operation('validate base campaign queue schema', async () => {
      for (const [table, names] of Object.entries(REQUIRED_BASE_COLUMNS)) {
        for (const name of names) if (!await column(q, table, name, transaction)) {
          throw Object.assign(new Error(`Required column is missing: ${table}.${name}`), { code: 'MIGRATION_SCHEMA_MISMATCH' });
        }
      }
    });

    for (const [table, name, definition, types] of NEW_COLUMNS) {
      await operation(`ensure column ${table}.${name}`, () => addOrValidateColumn(q, table, name, definition, types, transaction));
    }

    const [duplicateRows] = await operation('inspect duplicate campaign delivery jobs', () => q.sequelize.query(`SELECT
        mq.id,mq.campaign_id,mq.campaign_recipient_id,mq.status,mq.external_message_id,mq.attempts,
        mq.scheduled_at,mq.processed_at,mq.claimed_at,mq.locked_at,mq.worker_id,mq.created_at,mq.updated_at,mq.last_error,
        cr.status AS recipient_status,cr.external_message_id AS recipient_external_message_id,cr.queue_id AS recipient_queue_id
      FROM message_queue mq LEFT JOIN campaign_recipients cr ON cr.id=mq.campaign_recipient_id
      JOIN (SELECT campaign_id,campaign_recipient_id FROM message_queue
        WHERE campaign_id IS NOT NULL AND campaign_recipient_id IS NOT NULL
        GROUP BY campaign_id,campaign_recipient_id HAVING COUNT(*) > 1) duplicate
        ON duplicate.campaign_id=mq.campaign_id AND duplicate.campaign_recipient_id=mq.campaign_recipient_id
      ORDER BY mq.campaign_id,mq.campaign_recipient_id,mq.id`, { transaction }));
    const groups = new Map();
    for (const row of duplicateRows) {
      const key = `${row.campaign_id}:${row.campaign_recipient_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    }
    const classifications = [...groups.entries()].map(([key, rows]) => ({ key, rows, ...classifyDuplicateGroup(rows) }));
    const ambiguous = classifications.filter(group => group.ambiguous).map(group => ({
      campaignId: group.rows[0].campaign_id, campaignRecipientId: group.rows[0].campaign_recipient_id,
      queueIds: group.rows.map(row => row.id), externalMessageIds: [...new Set(group.rows.map(row => row.external_message_id).filter(Boolean))],
      recipientQueueId: group.rows[0].recipient_queue_id || null, classification: group.classification
    }));
    if (ambiguous.length) throw Object.assign(new Error('Conflicting submitted campaign jobs require manual review. No data was changed.'), {
      code: 'MIGRATION_DUPLICATES_AMBIGUOUS', migrationOperation: 'classify duplicate campaign delivery jobs', migrationDuplicates: ambiguous
    });
    await operation('supersede unambiguous duplicate campaign delivery jobs', async () => {
      for (const group of classifications) if (group.supersededIds.length) {
        await q.sequelize.query(`UPDATE message_queue SET status='cancelled',worker_id=NULL,locked_at=NULL,
          last_error='SUPERSEDED_DUPLICATE_CAMPAIGN_JOB',updated_at=NOW() WHERE id IN (:ids)`, {
          replacements: { ids: group.supersededIds }, transaction
        });
        console.log(`[${MIGRATION}] reconciled duplicate group ${group.key} as ${group.classification}; preserved queue ${group.canonicalId || 'none (recipient already terminal)'}; superseded ${group.supersededIds.length}`);
      }
    });

    await operation('ensure unique campaign recipient delivery index', async () => {
      const existing = await index(q, 'message_queue_campaign_recipient_unique', transaction);
      if (existing) {
        const normalized = existing.indexdef.toLowerCase().replace(/\s+/g, ' ');
        if (!normalized.includes('unique index') || !normalized.includes('(campaign_id, campaign_recipient_id)') || !normalized.includes("status <> 'cancelled'")) {
          throw Object.assign(new Error('message_queue_campaign_recipient_unique exists with an incompatible definition'), { code: 'MIGRATION_SCHEMA_MISMATCH' });
        }
        return;
      }
      await q.sequelize.query(`CREATE UNIQUE INDEX message_queue_campaign_recipient_unique
        ON message_queue(campaign_id,campaign_recipient_id)
        WHERE campaign_id IS NOT NULL AND campaign_recipient_id IS NOT NULL AND status <> 'cancelled'`, { transaction });
    });

    await operation('ensure claimable queue index', async () => {
      const existing = await index(q, 'message_queue_claimable_idx', transaction);
      if (existing) return;
      await q.sequelize.query('CREATE INDEX message_queue_claimable_idx ON message_queue(status,scheduled_at,locked_at)', { transaction });
    });
    await operation('commit migration', () => transaction.commit());
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    throw error;
  }
};

module.exports.down = async () => {};
module.exports._test = { tableNames, column, index, addOrValidateColumn, classifyDuplicateGroup };
