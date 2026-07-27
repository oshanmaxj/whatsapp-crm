const definitions = [
  ['New','new','#2196f3','open',1,false,false,false,false,false],
  ['Assigned','assigned','#5c6bc0','open',2,false,false,false,false,false],
  ['Call Pending','call_pending','#78909c','open',3,false,false,false,false,false],
  ['Calling','calling','#7e57c2','working',4,false,false,false,false,false],
  ['Contacted','contacted','#607d8b','contacted',5,false,false,true,false,false],
  ['No Answer','no_answer','#ef6c00','attempted',6,false,false,false,false,false],
  ['Busy','busy','#f9a825','attempted',7,false,false,false,false,false],
  ['Switched Off','switched_off','#757575','attempted',8,false,false,false,false,false],
  ['Call Rejected','call_rejected','#8d6e63','attempted',9,false,false,false,false,false],
  ['Wrong Number','wrong_number','#d32f2f','terminal',10,true,false,false,false,true],
  ['Interested','interested','#00a884','contacted',11,false,false,true,false,false],
  ['Follow-up Required','follow_up_required','#0288d1','followup',12,false,true,true,false,false],
  ['Not Interested','not_interested','#c62828','terminal',13,true,false,true,false,true],
  ['Agreed','agreed','#f57c00','qualified',14,false,false,true,false,false],
  ['Registered','registered','#43a047','converted',15,false,false,true,true,true],
  ['Lost','lost','#d32f2f','terminal',16,true,false,false,false,true]
];
const permissions=['view','create','update','disable','delete'].map(action=>[`lead_statuses.${action}`,`Lead statuses: ${action}`]);
const normalized=value=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const { inspectAllowedNextStatusType, allowedNextStatusParameter, allowedNextStatusSql } = require('./helpers/call_center_schema');

module.exports={definitions,async up(q,S){
 return q.sequelize.transaction(async transaction=>{
  if(q.sequelize.getDialect()==='postgres')await q.sequelize.query("SELECT pg_advisory_xact_lock(hashtext('migration:051_canonical_call_center_statuses'))",{transaction});
  const [before]=await q.sequelize.query('SELECT id,name,code,active FROM lead_status ORDER BY display_order,id',{transaction});
  const allowedType=await inspectAllowedNextStatusType(q,transaction);
  console.log('[051] lead statuses before',before.map(row=>({id:row.id,name:row.name,code:row.code,active:row.active})));
  for(const [name,code,color,category,displayOrder,reasonRequired,followupRequired,successfulContact,countsAsConversion,terminal] of definitions){
   const [matches]=await q.sequelize.query(`SELECT id,name,code FROM lead_status WHERE lower(trim(code))=:code OR (lower(trim(name))=lower(:name) AND (code IS NULL OR trim(code)='')) ORDER BY CASE WHEN lower(trim(code))=:code THEN 0 ELSE 1 END,id FOR UPDATE`,{replacements:{code,name},transaction});
   if(matches.length>1)throw Object.assign(new Error(`Multiple lead statuses match canonical key ${code}; administrator review is required.`),{code:'LEAD_STATUS_CANONICAL_CONFLICT'});
   if(!matches[0]){
    await q.sequelize.query(`INSERT INTO lead_status(name,code,color,category,display_order,active,reason_required,followup_required,successful_contact,counts_as_conversion,terminal,is_closed,is_won,is_lost,allowed_next_status_ids,created_at,updated_at) VALUES(:name,:code,:color,:category,:displayOrder,true,:reasonRequired,:followupRequired,:successfulContact,:countsAsConversion,:terminal,:terminal,:countsAsConversion,:isLost,${allowedNextStatusSql(allowedType)},NOW(),NOW())`,{replacements:{name,code,color,category,displayOrder,reasonRequired,followupRequired,successfulContact,countsAsConversion,terminal,isLost:code==='lost',allowedNextStatusIds:allowedNextStatusParameter([],allowedType)},transaction});
   }
  }
  const indexes=await q.showIndex('lead_status',{transaction});
  if(!indexes.some(index=>index.unique&&index.fields?.some(field=>field.attribute==='code')))await q.addIndex('lead_status',['code'],{name:'lead_status_code_uq',unique:true,transaction});
  for(const [code,name] of permissions){
   const [rows]=await q.sequelize.query('SELECT id FROM permissions WHERE code=:code',{replacements:{code},transaction});
   if(!rows[0])await q.bulkInsert('permissions',[{code,name,description:name,created_at:new Date(),updated_at:new Date()}],{transaction});
  }
  const [after]=await q.sequelize.query('SELECT id,name,code,active FROM lead_status ORDER BY display_order,id',{transaction});
  console.log('[051] lead statuses after',after.map(row=>({id:row.id,name:row.name,code:row.code,active:row.active})));
  const legacy=after.filter(row=>row.code&&!definitions.some(def=>def[1]===normalized(row.code)));
  if(legacy.length)console.warn('[051] legacy statuses require administrator review',legacy.map(row=>({id:row.id,name:row.name,code:row.code})));
 });
},async down(){}};
