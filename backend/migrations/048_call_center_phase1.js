async function add(q, table, column, definition) { const current = await q.describeTable(table); if (!current[column]) await q.addColumn(table, column, definition); }
module.exports = { async up(q, S) {
  for (const [c,d] of [
    ['category',{type:S.STRING(40),allowNull:false,defaultValue:'open'}],['reason_required',{type:S.BOOLEAN,allowNull:false,defaultValue:false}],
    ['followup_required',{type:S.BOOLEAN,allowNull:false,defaultValue:false}],['successful_contact',{type:S.BOOLEAN,allowNull:false,defaultValue:false}],
    ['counts_as_conversion',{type:S.BOOLEAN,allowNull:false,defaultValue:false}],['terminal',{type:S.BOOLEAN,allowNull:false,defaultValue:false}],
    ['allowed_next_status_ids',{type:S.JSON,allowNull:false,defaultValue:[]}]
  ]) await add(q,'lead_status',c,d);
  await q.createTable('call_activities',{
    id:{type:S.BIGINT,autoIncrement:true,primaryKey:true},lead_id:{type:S.BIGINT,allowNull:false},contact_id:{type:S.BIGINT},agent_user_id:{type:S.BIGINT,allowNull:false},
    whatsapp_account_id:{type:S.BIGINT},course_id:{type:S.BIGINT},direction:{type:S.STRING(20),allowNull:false,defaultValue:'outbound'},
    method:{type:S.STRING(30),allowNull:false,defaultValue:'mobile_manual'},verification_source:{type:S.STRING(30),allowNull:false,defaultValue:'agent_reported'},
    started_at:{type:S.DATE,allowNull:false},answered_at:{type:S.DATE},ended_at:{type:S.DATE},duration_seconds:{type:S.INTEGER},talk_time_seconds:{type:S.INTEGER},
    disposition:{type:S.STRING(40)},previous_status_id:{type:S.INTEGER},new_status_id:{type:S.INTEGER},notes:{type:S.TEXT},next_followup_at:{type:S.DATE},
    recording_reference:{type:S.TEXT},external_call_id:{type:S.STRING(180),unique:true},idempotency_key:{type:S.STRING(180),unique:true},
    attribution_key:{type:S.STRING(180),allowNull:false,unique:true},created_at:{type:S.DATE,allowNull:false,defaultValue:S.fn('NOW')},updated_at:{type:S.DATE,allowNull:false,defaultValue:S.fn('NOW')}
  }).catch(()=>{});
  await q.createTable('lead_status_history',{
    id:{type:S.BIGINT,autoIncrement:true,primaryKey:true},lead_id:{type:S.BIGINT,allowNull:false},from_status_id:{type:S.INTEGER},to_status_id:{type:S.INTEGER,allowNull:false},
    changed_by_user_id:{type:S.BIGINT},changed_at:{type:S.DATE,allowNull:false},duration_in_previous_status_seconds:{type:S.INTEGER},reason:{type:S.TEXT},source:{type:S.STRING(40),allowNull:false},
    call_activity_id:{type:S.BIGINT},created_at:{type:S.DATE,allowNull:false,defaultValue:S.fn('NOW')}
  }).catch(()=>{});
  await q.createTable('conversion_attributions',{
    id:{type:S.BIGINT,autoIncrement:true,primaryKey:true},lead_id:{type:S.BIGINT,allowNull:false},course_id:{type:S.BIGINT},original_owner_user_id:{type:S.BIGINT},
    converting_user_id:{type:S.BIGINT},converted_at:{type:S.DATE,allowNull:false},attribution_method:{type:S.STRING(40),allowNull:false},call_activity_id:{type:S.BIGINT},
    created_at:{type:S.DATE,allowNull:false,defaultValue:S.fn('NOW')},updated_at:{type:S.DATE,allowNull:false,defaultValue:S.fn('NOW')}
  }).catch(()=>{});
  for(const [t,f,n,u] of [['call_activities',['agent_user_id','started_at'],'call_agent_started_idx'],['call_activities',['lead_id','started_at'],'call_lead_started_idx'],['lead_status_history',['to_status_id','changed_at'],'lead_status_changed_idx'],['conversion_attributions',['attribution_key'],'conversion_attribution_key_uq',true]]) await q.addIndex(t,f,{name:n,unique:!!u}).catch(()=>{});
}, async down(){} };
