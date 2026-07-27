const test=require('node:test'),assert=require('node:assert/strict'),S=require('sequelize');
const migration=require('../migrations/048_call_center_phase1');
const {conversionAttributionKey}=require('../src/utils/conversionAttributionKey');

function environment({productionStyle=false,rows=[]}={}){
 let state={
  tables:{lead_status:{id:{}},...(productionStyle?{conversion_attributions:{id:{},lead_id:{},course_id:{allowNull:true},attribution_method:{},created_at:{},updated_at:{}}}:{})},
  indexes:{conversion_attributions:productionStyle?[{name:'conversion_attributions_pkey'}]:[]},
  rows:rows.map(row=>({...row}))
 };
 const q={
  sequelize:{
   getDialect:()=> 'postgres',
   async transaction(callback){const snapshot={tables:Object.fromEntries(Object.entries(state.tables).map(([name,columns])=>[name,{...columns}])),indexes:Object.fromEntries(Object.entries(state.indexes).map(([name,indexes])=>[name,indexes.map(index=>({...index}))])),rows:state.rows.map(row=>({...row}))};try{return await callback({id:'tx'});}catch(error){state=snapshot;throw error;}},
   async query(sql){
    if(/pg_advisory_xact_lock/.test(sql))return[[],{}];
    if(/COUNT\(\*\)::int AS total_rows/.test(sql))return[[{total_rows:state.rows.length,unique_leads:new Set(state.rows.map(row=>row.lead_id)).size,rows_without_course:state.rows.filter(row=>row.course_id==null).length,rows_without_call:state.rows.filter(row=>row.call_activity_id==null).length}]];
    if(/UPDATE conversion_attributions/.test(sql)){state.rows.forEach(row=>{if(!row.attribution_key)row.attribution_key=conversionAttributionKey(row.lead_id,row.course_id);});return[[],{}];}
    if(/GROUP BY attribution_key/.test(sql)){const counts=new Map();state.rows.forEach(row=>counts.set(row.attribution_key,(counts.get(row.attribution_key)||0)+1));return[[...counts].filter(([,count])=>count>1).map(([attribution_key,row_count])=>({attribution_key,row_count}))];}
    if(/COUNT\(\*\)::int AS count/.test(sql))return[[{count:state.rows.filter(row=>!row.attribution_key).length}]];
    throw new Error(`Unexpected SQL: ${sql}`);
   }
  },
  async showAllTables(){return Object.keys(state.tables);},
  async describeTable(table){return state.tables[table]||{};},
  async addColumn(table,column,definition){state.tables[table][column]={...definition};},
  async createTable(table,columns){state.tables[table]={...columns};state.indexes[table]=state.indexes[table]||[];},
  async showIndex(table){return state.indexes[table]||[];},
  async addIndex(table,fields,options){state.indexes[table]=state.indexes[table]||[];state.indexes[table].push({name:options.name,fields,unique:options.unique});},
  async changeColumn(table,column,definition){state.tables[table][column]={...definition};}
 };
 return{q,get state(){return state;}};
}

test('migration 048 creates a fresh schema and is safely rerunnable',async()=>{
 const env=environment();
 await migration.up(env.q,S);await migration.up(env.q,S);
 assert.ok(env.state.tables.lead_status.allowed_next_status_ids);
 assert.ok(env.state.tables.call_activities);
 assert.ok(env.state.tables.lead_status_history);
 assert.equal(env.state.tables.conversion_attributions.attribution_key.allowNull,false);
 assert.equal(env.state.indexes.conversion_attributions.filter(index=>index.name==='conversion_attribution_key_uq').length,1);
});

test('migration 048 repairs the observed production-style table before indexing',async()=>{
 const env=environment({productionStyle:true,rows:[
  {id:1,lead_id:1209,course_id:null,call_activity_id:null},
  {id:2,lead_id:1210,course_id:88,call_activity_id:7}
 ]});
 await migration.up(env.q,S);
 assert.deepEqual(env.state.rows.map(row=>row.attribution_key),['lead:1209:course:none','lead:1210:course:88']);
 assert.equal(env.state.tables.conversion_attributions.attribution_key.allowNull,false);
 assert.ok(env.state.indexes.conversion_attributions.some(index=>index.name==='conversion_attribution_key_uq'&&index.unique));
});

test('migration 048 reports collisions and transaction rollback leaves no partial column',async()=>{
 const env=environment({productionStyle:true,rows:[
  {id:1,lead_id:1209,course_id:null},
  {id:2,lead_id:1209,course_id:null}
 ]});
 await assert.rejects(migration.up(env.q,S),error=>error.code==='CONVERSION_ATTRIBUTION_COLLISIONS');
 assert.equal(env.state.tables.conversion_attributions.attribution_key,undefined);
 assert.equal(env.state.indexes.conversion_attributions.some(index=>index.name==='conversion_attribution_key_uq'),false);
});

test('conversion attribution model and service share deterministic nullable-course keys',()=>{
 assert.equal(conversionAttributionKey(1209,null),'lead:1209:course:none');
 assert.equal(conversionAttributionKey(1209,44),'lead:1209:course:44');
 const {ConversionAttribution}=require('../src/models');
 assert.equal(ConversionAttribution.rawAttributes.attributionKey.field,'attribution_key');
});

test('call model distinguishes reported calls from provider-confirmed calls',()=>{
 const {CallActivity}=require('../src/models');assert.equal(CallActivity.rawAttributes.verificationSource.defaultValue,'agent_reported');
 assert.ok(CallActivity.rawAttributes.externalCallId);
});
