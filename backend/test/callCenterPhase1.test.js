const test=require('node:test'),assert=require('node:assert/strict'),S=require('sequelize');
const fs=require('node:fs'),path=require('node:path');
const migration=require('../migrations/048_call_center_phase1');
const {conversionAttributionKey}=require('../src/utils/conversionAttributionKey');

function environment({productionStyle=false,rows=[]}={}){
 let state={
  tables:{lead_status:{id:{}},...(productionStyle?{conversion_attributions:{id:{},lead_id:{},course_id:{allowNull:true},attribution_method:{},created_at:{},updated_at:{}}}:{})},
  indexes:{conversion_attributions:productionStyle?[{name:'conversion_attributions_pkey'}]:[]},
  rows:rows.map(row=>({...row}))
 };
 let activeTransaction=null;
 const requireTransaction=options=>assert.equal(options?.transaction,activeTransaction,'migration operation escaped its transaction');
 const q={
  sequelize:{
   getDialect:()=> 'postgres',
   options:{pool:{max:2}},
   async transaction(callback){const snapshot={tables:Object.fromEntries(Object.entries(state.tables).map(([name,columns])=>[name,{...columns}])),indexes:Object.fromEntries(Object.entries(state.indexes).map(([name,indexes])=>[name,indexes.map(index=>({...index}))])),rows:state.rows.map(row=>({...row}))};activeTransaction={id:'tx'};try{return await callback(activeTransaction);}catch(error){state=snapshot;throw error;}finally{activeTransaction=null;}},
   async query(sql,options){
    requireTransaction(options);
    if(/^SET LOCAL/.test(sql))return[[],{}];
    if(/pg_advisory_xact_lock/.test(sql))return[[],{}];
    if(/information_schema\.tables/.test(sql))return[[{exists:Boolean(state.tables[options.replacements.table])}]];
    if(/information_schema\.columns/.test(sql)){
     const definition=state.tables[options.replacements.table]?.[options.replacements.column];
     return[definition?[{column_name:options.replacements.column,is_nullable:definition.allowNull===false?'NO':'YES',data_type:'character varying',udt_name:'varchar',column_default:null}]:[]];
    }
    if(/FROM pg_indexes/.test(sql))return[[(state.indexes[options.replacements.table]||[]).find(index=>index.name===options.replacements.index)?{indexname:options.replacements.index}:null].filter(Boolean)];
    if(/COUNT\(\*\)::int AS total_rows/.test(sql))return[[{total_rows:state.rows.length,unique_leads:new Set(state.rows.map(row=>row.lead_id)).size,rows_without_course:state.rows.filter(row=>row.course_id==null).length,rows_without_call:state.rows.filter(row=>row.call_activity_id==null).length}]];
    if(/UPDATE conversion_attributions/.test(sql)){state.rows.forEach(row=>{if(!row.attribution_key)row.attribution_key=conversionAttributionKey(row.lead_id,row.course_id);});return[[],{}];}
    if(/GROUP BY attribution_key/.test(sql)){const counts=new Map();state.rows.forEach(row=>counts.set(row.attribution_key,(counts.get(row.attribution_key)||0)+1));return[[...counts].filter(([,count])=>count>1).map(([attribution_key,row_count])=>({attribution_key,row_count}))];}
    if(/COUNT\(\*\)::int AS count/.test(sql))return[[{count:state.rows.filter(row=>!row.attribution_key).length}]];
    throw new Error(`Unexpected SQL: ${sql}`);
   }
  },
  async addColumn(table,column,definition,options){requireTransaction(options);state.tables[table][column]={...definition};},
  async createTable(table,columns,options){requireTransaction(options);state.tables[table]={...columns};state.indexes[table]=state.indexes[table]||[];},
  async addIndex(table,fields,options){requireTransaction(options);state.indexes[table]=state.indexes[table]||[];state.indexes[table].push({name:options.name,fields,unique:options.unique});},
  async changeColumn(table,column,definition,options){requireTransaction(options);state.tables[table][column]={...definition};}
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

test('migration 048 completes with a two-connection pool without acquiring a second connection',async()=>{
 const env=environment({productionStyle:true});
 assert.equal(env.q.sequelize.options.pool.max,2);
 await Promise.race([
  migration.up(env.q,S),
  new Promise((_,reject)=>setTimeout(()=>reject(new Error('migration waited on itself')),1000))
 ]);
 assert.ok(env.state.indexes.conversion_attributions.some(index=>index.name==='conversion_attribution_key_uq'));
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

test('migration 048 uses transaction-bound catalogs and no model schema helpers',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../migrations/048_call_center_phase1.js'),'utf8');
 assert.doesNotMatch(source,/showAllTables|describeTable|showIndex|Model\.sync|\.sync\(/);
 assert.match(source,/information_schema\.columns/);
 assert.match(source,/information_schema\.tables/);
 assert.match(source,/FROM pg_indexes/);
 assert.match(source,/SET LOCAL lock_timeout/);
 assert.match(source,/SET LOCAL statement_timeout/);
});

test('call model distinguishes reported calls from provider-confirmed calls',()=>{
 const {CallActivity}=require('../src/models');assert.equal(CallActivity.rawAttributes.verificationSource.defaultValue,'agent_reported');
 assert.ok(CallActivity.rawAttributes.externalCallId);
});
