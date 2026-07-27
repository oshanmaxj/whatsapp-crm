const { Op }=require('sequelize');
const db=require('../models');
const audit=require('./audit.service');
const fail=(code,message,status=400,errors)=>Object.assign(new Error(message),{code,status,errors,exposeMessage:true});
const slug=value=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
const fields=['name','code','color','category','displayOrder','active','countsAsConversion','terminal','reasonRequired','followupRequired','successfulContact','allowedNextStatusIds'];
const protectedCanonicalCodes=new Set(['new','assigned','call_pending','calling','contacted','no_answer','busy','switched_off','call_rejected','wrong_number','interested','follow_up_required','not_interested','agreed','registered','lost']);
function values(input){const output={};for(const field of fields)if(input[field]!==undefined)output[field]=input[field];if(output.code!==undefined)output.code=slug(output.code);if(output.name!==undefined)output.name=String(output.name).trim();if(output.color!==undefined)output.color=String(output.color).trim();if(output.category!==undefined)output.category=slug(output.category);if(output.allowedNextStatusIds!==undefined)output.allowedNextStatusIds=[...new Set((output.allowedNextStatusIds||[]).map(Number).filter(Number.isInteger))];return output;}
function validate(input,creating=false){const errors={};if(creating||input.name!==undefined)if(!String(input.name||'').trim())errors.name='Display name is required.';if(creating||input.code!==undefined)if(!slug(input.code))errors.code='Canonical key is required.';if(creating||input.color!==undefined)if(!/^#[0-9a-f]{6}$/i.test(String(input.color||'')))errors.color='Enter a six-digit hex color.';if(creating||input.category!==undefined)if(!slug(input.category))errors.category='Category is required.';if(Object.keys(errors).length)throw fail('VALIDATION_FAILED','Validation failed',422,errors);}
class LeadStatusAdminService{
 async usage(id,transaction=null){
  const [leads,fromHistory,toHistory,previousCalls,newCalls]=await Promise.all([
   db.Lead.count({where:{statusId:id},paranoid:false,transaction}),db.LeadStatusHistory.count({where:{fromStatusId:id},transaction}),db.LeadStatusHistory.count({where:{toStatusId:id},transaction}),db.CallActivity.count({where:{previousStatusId:id},transaction}),db.CallActivity.count({where:{newStatusId:id},transaction})
  ]);const status=await db.LeadStatus.findByPk(id,{paranoid:false,transaction,attributes:['code']});const configuration=protectedCanonicalCodes.has(status?.code)?1:0;return{leads,statusHistory:fromHistory+toHistory,callResults:previousCalls+newCalls,configuration,total:leads+fromHistory+toHistory+previousCalls+newCalls+configuration};
 }
 async list(){const rows=await db.LeadStatus.findAll({order:[['display_order','ASC'],['id','ASC']]});return Promise.all(rows.map(async row=>({...row.toJSON(),usage:await this.usage(row.id)})));}
 async save(id,input,actor){
  validate(input,!id);const data=values(input);
  return db.sequelize.transaction(async transaction=>{
   let row=id?await db.LeadStatus.findByPk(id,{paranoid:false,transaction,lock:transaction.LOCK.UPDATE}):null;if(id&&!row)throw fail('LEAD_STATUS_NOT_FOUND','Lead status not found.',404);
   const duplicate=await db.LeadStatus.findOne({where:{code:data.code??row?.code,...(id?{id:{[Op.ne]:id}}:{})},paranoid:false,transaction});if(duplicate)throw fail('LEAD_STATUS_DUPLICATE','Canonical key already exists.',409,{code:'Canonical key already exists.'});
   if(row&&data.code!==undefined&&data.code!==row.code&&(await this.usage(row.id,transaction)).total>0)throw fail('LEAD_STATUS_CODE_LOCKED','Canonical key cannot change after first use.',409,{code:'Canonical key cannot change after first use.'});
   if(data.allowedNextStatusIds?.length){const count=await db.LeadStatus.count({where:{id:{[Op.in]:data.allowedNextStatusIds}},transaction});if(count!==data.allowedNextStatusIds.length)throw fail('VALIDATION_FAILED','Validation failed',422,{allowedNextStatusIds:'Choose valid next statuses.'});}
   row=row?await row.update(data,{transaction}):await db.LeadStatus.create({...data,active:data.active!==false},{transaction});
   await audit.record({userId:actor.id,action:id?'LEAD_STATUS_UPDATED':'LEAD_STATUS_CREATED',entityType:'lead_status',entityId:row.id,changes:{fields:Object.keys(data)},transaction,required:true});return{...row.toJSON(),usage:await this.usage(row.id,transaction)};
  });
 }
 async disable(id,actor){return db.sequelize.transaction(async transaction=>{const row=await db.LeadStatus.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});if(!row)throw fail('LEAD_STATUS_NOT_FOUND','Lead status not found.',404);await row.update({active:false},{transaction});await audit.record({userId:actor.id,action:'LEAD_STATUS_DISABLED',entityType:'lead_status',entityId:id,changes:{active:false},transaction,required:true});return{...row.toJSON(),usage:await this.usage(id,transaction)};});}
 async remove(id,actor){return db.sequelize.transaction(async transaction=>{const row=await db.LeadStatus.findByPk(id,{transaction,lock:transaction.LOCK.UPDATE});if(!row)throw fail('LEAD_STATUS_NOT_FOUND','Lead status not found.',404);const usage=await this.usage(id,transaction);if(usage.total)throw fail('LEAD_STATUS_IN_USE','This status is in use and cannot be deleted. Disable it instead.',409,{usage});await row.destroy({transaction});await audit.record({userId:actor.id,action:'LEAD_STATUS_DELETED',entityType:'lead_status',entityId:id,changes:{code:row.code},transaction,required:true});return{id};});}
}
module.exports=new LeadStatusAdminService();
