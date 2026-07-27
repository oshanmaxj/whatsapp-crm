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
module.exports={async up(q){for(let i=0;i<statuses.length;i++){const[name,code,color,category,reasonRequired,followupRequired,successfulContact,terminal]=statuses[i];await q.bulkInsert('lead_status',[{name,code,color,category,reason_required:reasonRequired,followup_required:followupRequired,successful_contact:successfulContact,counts_as_conversion:false,terminal,allowed_next_status_ids:[],display_order:20+i,active:true,is_closed:terminal,is_won:false,is_lost:false,created_at:new Date(),updated_at:new Date()}]).catch(()=>{});}},async down(){}};
