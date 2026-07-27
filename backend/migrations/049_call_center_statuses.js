const statuses=[
 ['Assigned','assigned','#5c6bc0','open',false,false,false,false],
 ['Call Pending','call_pending','#78909c','open',false,false,false,false],
 ['Calling','calling','#7e57c2','working',false,false,false,false],
 ['No Answer','no_answer','#ef6c00','attempted',false,false,false,false],
 ['Busy','busy','#f9a825','attempted',false,false,false,false],
 ['Switched Off','switched_off','#757575','attempted',false,false,false,false],
 ['Wrong Number','wrong_number','#d32f2f','terminal',true,false,false,true],
 ['Connected','connected','#00897b','contacted',false,false,true,false],
 ['Follow-up Required','follow_up_required','#0288d1','followup',false,true,true,false],
 ['Not Interested','not_interested','#c62828','terminal',true,false,true,true]
];
const { inspectAllowedNextStatusType, allowedNextStatusParameter, allowedNextStatusSql } = require('./helpers/call_center_schema');

module.exports={statuses,async up(q){
 return q.sequelize.transaction(async transaction=>{
  if(q.sequelize.getDialect()==='postgres')await q.sequelize.query("SELECT pg_advisory_xact_lock(hashtext('migration:049_call_center_statuses'))",{transaction});
  const allowedType=await inspectAllowedNextStatusType(q,transaction);
  for(let i=0;i<statuses.length;i++){
   const[name,code,color,category,reasonRequired,followupRequired,successfulContact,terminal]=statuses[i];
   try{
    await q.sequelize.query(`INSERT INTO lead_status
      (name,code,color,category,reason_required,followup_required,successful_contact,counts_as_conversion,terminal,allowed_next_status_ids,display_order,active,is_closed,is_won,is_lost,created_at,updated_at)
      SELECT :name,:code,:color,:category,:reasonRequired,:followupRequired,:successfulContact,false,:terminal,${allowedNextStatusSql(allowedType)},:displayOrder,true,:terminal,false,false,NOW(),NOW()
      WHERE NOT EXISTS (SELECT 1 FROM lead_status WHERE lower(trim(code))=lower(:code))`,{replacements:{name,code,color,category,reasonRequired,followupRequired,successfulContact,terminal,allowedNextStatusIds:allowedNextStatusParameter([],allowedType),displayOrder:20+i},transaction});
   }catch(error){
    error.migrationOperation=`seed lead status ${code}`;
    throw error;
   }
  }
 });
},async down(){}};
