const LOCK = 570063;
const MIGRATION = '063_campaign_delivery_recovery.js';

const REQUIRED_TABLES = ['message_queue', 'campaign_recipients', 'campaigns'];
const REQUIRED_BASE_COLUMNS = {
  message_queue: ['id', 'status', 'scheduled_at', 'campaign_id', 'campaign_recipient_id'],
  campaign_recipients: ['id', 'campaign_id', 'status', 'external_message_id'],
  campaigns: ['id', 'status']
};
const NEW_COLUMNS = [
  ['message_queue', 'claimed_at', 'TIMESTAMPTZ', ['timestamp with time zone']],
  ['message_queue', 'locked_at', 'TIMESTAMPTZ', ['timestamp with time zone']],
  ['message_queue', 'worker_id', 'VARCHAR(160)', ['character varying']],
  ['message_queue', 'error_details', 'JSONB', ['jsonb']],
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
  const [rows] = await q.sequelize.query(`SELECT table_name FROM information_schema.tables
    WHERE table_schema=current_schema() AND table_name IN (:tables)`, {
    replacements: { tables: REQUIRED_TABLES }, transaction
  });
  return new Set(rows.map(row => row.table_name));
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

    const [duplicates] = await operation('check duplicate campaign delivery jobs', () => q.sequelize.query(`SELECT campaign_id,campaign_recipient_id,COUNT(*)::integer AS job_count
      FROM message_queue WHERE campaign_id IS NOT NULL AND campaign_recipient_id IS NOT NULL
      GROUP BY campaign_id,campaign_recipient_id HAVING COUNT(*) > 1 ORDER BY campaign_id,campaign_recipient_id LIMIT 25`, { transaction }));
    if (duplicates.length) throw Object.assign(new Error('Duplicate campaign delivery jobs prevent creation of the idempotency index. No data was changed.'), {
      code: 'MIGRATION_DUPLICATES_FOUND', migrationOperation: 'check duplicate campaign delivery jobs', migrationDuplicates: duplicates
    });

    for (const [table, name, definition, types] of NEW_COLUMNS) {
      await operation(`ensure column ${table}.${name}`, () => addOrValidateColumn(q, table, name, definition, types, transaction));
    }

    await operation('ensure unique campaign recipient delivery index', async () => {
      const existing = await index(q, 'message_queue_campaign_recipient_unique', transaction);
      if (existing) {
        const normalized = existing.indexdef.toLowerCase().replace(/\s+/g, ' ');
        if (!normalized.includes('unique index') || !normalized.includes('(campaign_id, campaign_recipient_id)')) {
          throw Object.assign(new Error('message_queue_campaign_recipient_unique exists with an incompatible definition'), { code: 'MIGRATION_SCHEMA_MISMATCH' });
        }
        return;
      }
      await q.sequelize.query(`CREATE UNIQUE INDEX message_queue_campaign_recipient_unique
        ON message_queue(campaign_id,campaign_recipient_id)
        WHERE campaign_id IS NOT NULL AND campaign_recipient_id IS NOT NULL`, { transaction });
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
module.exports._test = { tableNames, column, index, addOrValidateColumn };
