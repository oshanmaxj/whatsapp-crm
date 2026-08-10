'use strict';
const LOCK = 570045;
const MIGRATION = '045_whatsapp_ai_agents.js';
const tableExists = async (q, table, transaction) => {
  const [rows] = await q.sequelize.query(`SELECT 1 FROM information_schema.tables
    WHERE table_schema=current_schema() AND table_name=:table`, { replacements: { table }, transaction });
  return rows.length > 0;
};
const operation = async (name, fn) => {
  console.log(`[${MIGRATION}] ${name}`);
  try { return await fn(); } catch (error) { error.migrationOperation = name; throw error; }
};
const ensureIndex = async (q, { table, columns, name }, transaction) => {
  const [rows] = await q.sequelize.query(`SELECT indexdef FROM pg_indexes
    WHERE schemaname=current_schema() AND indexname=:name`, { replacements: { name }, transaction });
  if (rows.length) {
    const definition = rows[0].indexdef.toLowerCase().replace(/\s+/g, ' ');
    const expected = `(${columns.join(', ')})`;
    if (!definition.includes(` on ${table.toLowerCase()} `) && !definition.includes(` on public.${table.toLowerCase()} `)) {
      throw Object.assign(new Error(`${name} exists on a different table`), { code: 'MIGRATION_INDEX_MISMATCH' });
    }
    if (!definition.includes(expected)) throw Object.assign(new Error(`${name} has incompatible columns; expected ${expected}`), { code: 'MIGRATION_INDEX_MISMATCH' });
    console.log(`[${MIGRATION}] skip compatible index ${name}`);
    return;
  }
  await q.sequelize.query(`CREATE INDEX "${name}" ON "${table}" (${columns.map(column => `"${column}"`).join(',')})`, { transaction });
};

module.exports = { async up(q, S) {
  const D = S.DataTypes || S;
  const transaction = await q.sequelize.transaction();
  try {
    await operation('set bounded lock timeout', () => q.sequelize.query("SET LOCAL lock_timeout='10s'", { transaction }));
    await operation('set bounded statement timeout', () => q.sequelize.query("SET LOCAL statement_timeout='120s'", { transaction }));
    await operation('acquire advisory lock', () => q.sequelize.query('SELECT pg_advisory_xact_lock(:lock)', { replacements: { lock: LOCK }, transaction }));
    if (!await tableExists(q, 'ai_agents', transaction)) await operation('create ai_agents', () => q.createTable('ai_agents',{id:{type:D.BIGINT,autoIncrement:true,primaryKey:true},name:{type:D.STRING(180),allowNull:false},description:D.TEXT,whatsapp_account_ids:{type:D.JSONB,allowNull:false,defaultValue:[]},course_ids:{type:D.JSONB,allowNull:false,defaultValue:[]},department_id:D.INTEGER,primary_language:{type:D.STRING(30),allowNull:false,defaultValue:'en'},supported_languages:{type:D.JSONB,allowNull:false,defaultValue:['en']},system_instructions:D.TEXT,sales_script:D.TEXT,support_script:D.TEXT,qualification_questions:{type:D.JSONB,allowNull:false,defaultValue:[]},prohibited_statements:{type:D.JSONB,allowNull:false,defaultValue:[]},handover_rules:{type:D.JSONB,allowNull:false,defaultValue:{}},working_hours:{type:D.JSONB,allowNull:false,defaultValue:{}},response_delay_seconds:{type:D.INTEGER,allowNull:false,defaultValue:0},max_ai_replies:{type:D.INTEGER,allowNull:false,defaultValue:10},status:{type:D.STRING(20),allowNull:false,defaultValue:'paused'},model:{type:D.STRING(80),allowNull:false,defaultValue:'gpt-4.1-mini'},temperature:{type:D.DECIMAL(3,2),allowNull:false,defaultValue:.3},allowed_actions:{type:D.JSONB,allowNull:false,defaultValue:['send_text','request_human']},automation_priority:{type:D.STRING(30),allowNull:false,defaultValue:'flow_first_then_ai'},human_pause_minutes:{type:D.INTEGER,allowNull:false,defaultValue:60},created_by:D.BIGINT,updated_by:D.BIGINT,created_at:{type:D.DATE,allowNull:false},updated_at:{type:D.DATE,allowNull:false}},{transaction}));
    if (!await tableExists(q, 'ai_conversation_states', transaction)) await operation('create ai_conversation_states', () => q.createTable('ai_conversation_states',{id:{type:D.BIGINT,autoIncrement:true,primaryKey:true},conversation_id:{type:D.BIGINT,allowNull:false,unique:true,references:{model:'conversations',key:'id'},onDelete:'CASCADE'},ai_agent_id:{type:D.BIGINT,references:{model:'ai_agents',key:'id'},onDelete:'SET NULL'},state:{type:D.STRING(60),allowNull:false,defaultValue:'new_lead'},status:{type:D.STRING(25),allowNull:false,defaultValue:'active'},extracted_data:{type:D.JSONB,allowNull:false,defaultValue:{}},reply_count:{type:D.INTEGER,allowNull:false,defaultValue:0},paused_until:D.DATE,pause_reason:D.STRING(255),summary:D.TEXT,last_inbound_message_id:D.BIGINT,last_ai_reply_at:D.DATE,handover_at:D.DATE,created_at:{type:D.DATE,allowNull:false},updated_at:{type:D.DATE,allowNull:false}},{transaction}));
    if (!await tableExists(q, 'ai_knowledge_sources', transaction)) await operation('create ai_knowledge_sources', () => q.createTable('ai_knowledge_sources',{id:{type:D.BIGINT,autoIncrement:true,primaryKey:true},ai_agent_id:{type:D.BIGINT,references:{model:'ai_agents',key:'id'},onDelete:'CASCADE'},source_type:{type:D.STRING(40),allowNull:false},title:{type:D.STRING(255),allowNull:false},content:{type:D.TEXT,allowNull:false},source_record_type:D.STRING(60),source_record_id:D.BIGINT,status:{type:D.STRING(20),allowNull:false,defaultValue:'draft'},version:{type:D.INTEGER,allowNull:false,defaultValue:1},valid_from:D.DATE,valid_until:D.DATE,created_by:D.BIGINT,created_at:{type:D.DATE,allowNull:false},updated_at:{type:D.DATE,allowNull:false}},{transaction}));
    if (!await tableExists(q, 'ai_decision_logs', transaction)) await operation('create ai_decision_logs', () => q.createTable('ai_decision_logs',{id:{type:D.BIGINT,autoIncrement:true,primaryKey:true},ai_agent_id:{type:D.BIGINT,references:{model:'ai_agents',key:'id'},onDelete:'SET NULL'},conversation_id:{type:D.BIGINT,allowNull:false,references:{model:'conversations',key:'id'},onDelete:'CASCADE'},inbound_message_id:{type:D.BIGINT,unique:true},action:{type:D.STRING(50),allowNull:false},state_before:D.STRING(60),state_after:D.STRING(60),reason:D.TEXT,confidence:D.DECIMAL(5,4),details:{type:D.JSONB,allowNull:false,defaultValue:{}},duration_ms:D.INTEGER,status:{type:D.STRING(20),allowNull:false,defaultValue:'completed'},created_at:{type:D.DATE,allowNull:false}},{transaction}));
    for (const spec of [
      {table:'ai_agents',columns:['status'],name:'ai_agents_status_idx'},
      {table:'ai_conversation_states',columns:['ai_agent_id','status'],name:'ai_state_agent_status_idx'},
      {table:'ai_knowledge_sources',columns:['ai_agent_id','status','valid_from','valid_until'],name:'ai_knowledge_valid_idx'},
      {table:'ai_decision_logs',columns:['conversation_id','created_at'],name:'ai_decisions_conversation_idx'}
    ]) await operation(`ensure index ${spec.name}`, () => ensureIndex(q, spec, transaction));
    await transaction.commit();
  } catch (error) { if (!transaction.finished) await transaction.rollback(); throw error; }
}, async down(){/* Data-retaining migration: disable agents before reverting application code. */}, _test: { tableExists, ensureIndex } };
