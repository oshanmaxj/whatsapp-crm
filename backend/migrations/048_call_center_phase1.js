async function operation(name, callback) {
  try {
    console.log(`[048_call_center_phase1] ${name}`);
    return await callback();
  } catch (error) {
    error.migrationOperation = name;
    const original = error.original || error.parent || error;
    console.error('[048_call_center_phase1] operation failed; transaction will roll back', {
      operation: name,
      message: original.message || error.message,
      sqlState: original.code || null,
      table: original.table || null,
      column: original.column || null,
      constraint: original.constraint || null
    });
    throw error;
  }
}

async function tableNames(queryInterface) {
  return (await queryInterface.showAllTables()).map(value => String(value?.tableName || value).toLowerCase());
}

async function addColumnIfMissing(queryInterface, table, column, definition, transaction) {
  const description = await queryInterface.describeTable(table);
  if (!description[column]) await operation(`add ${table}.${column}`, () =>
    queryInterface.addColumn(table, column, definition, { transaction })
  );
}

async function addIndexIfMissing(queryInterface, table, fields, options, transaction) {
  const indexes = await queryInterface.showIndex(table, { transaction });
  if (!indexes.some(index => index.name === options.name)) {
    await operation(`create ${options.name}`, () =>
      queryInterface.addIndex(table, fields, { ...options, transaction })
    );
  }
}

module.exports = {
  async up(queryInterface, Sequelize) {
    if (queryInterface.sequelize.getDialect() !== 'postgres') throw new Error('Migration 048 requires PostgreSQL.');
    return queryInterface.sequelize.transaction(async transaction => {
      await operation('acquire advisory migration lock', () =>
        queryInterface.sequelize.query("SELECT pg_advisory_xact_lock(hashtext('migration:048_call_center_phase1'))", { transaction })
      );

      for (const [column, definition] of [
        ['category', { type: Sequelize.STRING(40), allowNull: false, defaultValue: 'open' }],
        ['reason_required', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }],
        ['followup_required', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }],
        ['successful_contact', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }],
        ['counts_as_conversion', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }],
        ['terminal', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false }],
        ['allowed_next_status_ids', { type: Sequelize.JSON, allowNull: false, defaultValue: [] }]
      ]) await addColumnIfMissing(queryInterface, 'lead_status', column, definition, transaction);

      const tables = await tableNames(queryInterface);
      if (!tables.includes('call_activities')) await operation('create call_activities', () => queryInterface.createTable('call_activities', {
        id:{type:Sequelize.BIGINT,autoIncrement:true,primaryKey:true},lead_id:{type:Sequelize.BIGINT,allowNull:false},contact_id:{type:Sequelize.BIGINT},agent_user_id:{type:Sequelize.BIGINT,allowNull:false},
        whatsapp_account_id:{type:Sequelize.BIGINT},course_id:{type:Sequelize.BIGINT},direction:{type:Sequelize.STRING(20),allowNull:false,defaultValue:'outbound'},
        method:{type:Sequelize.STRING(30),allowNull:false,defaultValue:'mobile_manual'},verification_source:{type:Sequelize.STRING(30),allowNull:false,defaultValue:'agent_reported'},
        started_at:{type:Sequelize.DATE,allowNull:false},answered_at:{type:Sequelize.DATE},ended_at:{type:Sequelize.DATE},duration_seconds:{type:Sequelize.INTEGER},talk_time_seconds:{type:Sequelize.INTEGER},
        disposition:{type:Sequelize.STRING(40)},previous_status_id:{type:Sequelize.INTEGER},new_status_id:{type:Sequelize.INTEGER},notes:{type:Sequelize.TEXT},next_followup_at:{type:Sequelize.DATE},
        recording_reference:{type:Sequelize.TEXT},external_call_id:{type:Sequelize.STRING(180),unique:true},idempotency_key:{type:Sequelize.STRING(180),unique:true},
        attribution_key:{type:Sequelize.STRING(180),allowNull:false,unique:true},created_at:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.fn('NOW')},updated_at:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.fn('NOW')}
      }, { transaction }));

      if (!tables.includes('lead_status_history')) await operation('create lead_status_history', () => queryInterface.createTable('lead_status_history', {
        id:{type:Sequelize.BIGINT,autoIncrement:true,primaryKey:true},lead_id:{type:Sequelize.BIGINT,allowNull:false},from_status_id:{type:Sequelize.INTEGER},to_status_id:{type:Sequelize.INTEGER,allowNull:false},
        changed_by_user_id:{type:Sequelize.BIGINT},changed_at:{type:Sequelize.DATE,allowNull:false},duration_in_previous_status_seconds:{type:Sequelize.INTEGER},reason:{type:Sequelize.TEXT},source:{type:Sequelize.STRING(40),allowNull:false},
        call_activity_id:{type:Sequelize.BIGINT},created_at:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.fn('NOW')}
      }, { transaction }));

      if (!tables.includes('conversion_attributions')) await operation('create conversion_attributions', () => queryInterface.createTable('conversion_attributions', {
        id:{type:Sequelize.BIGINT,autoIncrement:true,primaryKey:true},lead_id:{type:Sequelize.BIGINT,allowNull:false},course_id:{type:Sequelize.BIGINT},original_owner_user_id:{type:Sequelize.BIGINT},
        converting_user_id:{type:Sequelize.BIGINT},converted_at:{type:Sequelize.DATE,allowNull:false},attribution_method:{type:Sequelize.STRING(40),allowNull:false},call_activity_id:{type:Sequelize.BIGINT},
        attribution_key:{type:Sequelize.STRING(180),allowNull:false},created_at:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.fn('NOW')},updated_at:{type:Sequelize.DATE,allowNull:false,defaultValue:Sequelize.fn('NOW')}
      }, { transaction }));

      await addColumnIfMissing(queryInterface, 'conversion_attributions', 'attribution_key', {
        type: Sequelize.STRING(180), allowNull: true
      }, transaction);

      const [summary] = await operation('inspect conversion attribution rows', () => queryInterface.sequelize.query(
        `SELECT COUNT(*)::int AS total_rows,
                COUNT(DISTINCT lead_id)::int AS unique_leads,
                COUNT(*) FILTER (WHERE course_id IS NULL)::int AS rows_without_course,
                COUNT(*) FILTER (WHERE call_activity_id IS NULL)::int AS rows_without_call
           FROM conversion_attributions`,
        { transaction }
      ));
      console.log('[048_call_center_phase1] conversion attribution summary', summary[0]);

      await operation('backfill deterministic conversion attribution keys', () => queryInterface.sequelize.query(
        `UPDATE conversion_attributions
            SET attribution_key = 'lead:' || lead_id::text || ':course:' || COALESCE(course_id::text,'none')
          WHERE attribution_key IS DISTINCT FROM ('lead:' || lead_id::text || ':course:' || COALESCE(course_id::text,'none'))`,
        { transaction }
      ));

      const [collisions] = await operation('check conversion attribution key collisions', () => queryInterface.sequelize.query(
        `SELECT attribution_key,COUNT(*)::int AS row_count
           FROM conversion_attributions
          GROUP BY attribution_key
         HAVING COUNT(*)>1
          ORDER BY row_count DESC,attribution_key
          LIMIT 50`,
        { transaction }
      ));
      if (collisions.length) {
        const error = new Error(`Conversion attribution business-key collisions require review before migration can continue (${collisions.length} shown).`);
        error.code = 'CONVERSION_ATTRIBUTION_COLLISIONS';
        error.migrationCollisions = collisions;
        throw error;
      }
      const [missing] = await queryInterface.sequelize.query(
        `SELECT COUNT(*)::int AS count FROM conversion_attributions WHERE attribution_key IS NULL OR btrim(attribution_key)=''`,
        { transaction }
      );
      if (Number(missing[0].count)) throw new Error('Conversion attribution backfill left rows without attribution_key.');

      const conversionDescription = await queryInterface.describeTable('conversion_attributions');
      if (conversionDescription.attribution_key.allowNull !== false) await operation('make conversion_attributions.attribution_key not null', () =>
        queryInterface.changeColumn('conversion_attributions', 'attribution_key', {
          type: Sequelize.STRING(180), allowNull: false
        }, { transaction })
      );

      await addIndexIfMissing(queryInterface, 'call_activities', ['agent_user_id','started_at'], { name:'call_agent_started_idx' }, transaction);
      await addIndexIfMissing(queryInterface, 'call_activities', ['lead_id','started_at'], { name:'call_lead_started_idx' }, transaction);
      await addIndexIfMissing(queryInterface, 'lead_status_history', ['to_status_id','changed_at'], { name:'lead_status_changed_idx' }, transaction);
      await addIndexIfMissing(queryInterface, 'conversion_attributions', ['attribution_key'], { name:'conversion_attribution_key_uq', unique:true }, transaction);
    });
  },
  async down() {}
};
