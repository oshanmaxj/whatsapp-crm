const { Op, fn, col }=require('sequelize');
const db=require('../models');
const leadStatusService=require('./leadStatus.service');
const audit=require('./audit.service');
const crypto=require('crypto');
const logger=require('../config/logger');
const {conversionAttributionKey}=require('../utils/conversionAttributionKey');
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,message,status,exposeMessage:true});
const own=(actor,id)=>actor?.isSystemAdmin||actor?.permissions?.includes('calls.view.team')||String(actor?.id)===String(id);
const clean=v=>String(v??'').trim();
const validPhone=v=>/^\+?[0-9][0-9 ()-]{5,24}$/.test(clean(v));
const dispositionCode=v=>clean(v).toLowerCase().replace(/[\s-]+/g,'_');
const dispositionStatuses={answered:'contacted',no_answer:'no_answer',busy:'busy',switched_off:'switched_off',call_rejected:'call_rejected',call_back_later:'follow_up_required',interested:'interested',not_interested:'not_interested',agreed:'agreed',registered:'registered',lost:'lost',wrong_number:'wrong_number',technical_failure:'call_pending'};
async function operation(context,name,query){
 logger.info('call_center_transaction_operation',{requestId:context.requestId,transactionId:context.transactionId,operation:name});
 try{return await query();}catch(error){
  const original=error.original||error.parent||error;
  logger.error('call_center_transaction_operation_failed',{requestId:context.requestId,transactionId:context.transactionId,operation:name,message:original.message||error.message,sqlState:original.code||null,table:original.table||null,column:original.column||null,constraint:original.constraint||null,model:error.model?.name||null});
  throw error;
 }
}
function periodRange(period='today'){const local=new Date(Date.now()+19800000),y=local.getUTCFullYear(),m=local.getUTCMonth(),d=local.getUTCDate();let start=new Date(Date.UTC(y,m,d)-19800000),end=new Date(start.getTime()+86400000);if(period==='yesterday'){end=start;start=new Date(start-86400000);}if(period==='week'){const day=(local.getUTCDay()+6)%7;start=new Date(start-day*86400000);}if(period==='month')start=new Date(Date.UTC(y,m,1)-19800000);return{start,end};}
class CallCenterService{
 leadScope(actor){return actor?.isSystemAdmin||actor?.permissions?.includes('calls.view.team')||actor?.permissions?.includes('callcenter.team.view')?{}:{ownerId:actor.id};}
 async options(query,actor){
  const statuses=await db.LeadStatus.findAll({where:{active:true},order:[['display_order','ASC']]});
  return{leads:[],statuses:statuses.map(s=>({id:s.id,code:s.code,name:s.name,color:s.color,reasonRequired:s.reasonRequired,followupRequired:s.followupRequired,allowedNextStatusIds:s.allowedNextStatusIds}))};
 }
 async active(actor){return db.CallActivity.findOne({where:{agentUserId:actor.id,endedAt:null},include:[{model:db.Lead,as:'lead',include:[{model:db.Contact,as:'contact'},{model:db.LeadStatus,as:'status'}]}],order:[['started_at','DESC']]});}
 async queue(actor){
  const leads=await db.Lead.findAll({where:this.leadScope(actor),include:[{model:db.Contact,as:'contact'},{model:db.LeadStatus,as:'status'}],limit:200});
  const ids=leads.map(l=>l.id),calls=ids.length?await db.CallActivity.findAll({where:{leadId:{[Op.in]:ids},endedAt:{[Op.ne]:null}},order:[['started_at','DESC']]}):[];
  const byLead=new Map();for(const c of calls){const k=String(c.leadId),v=byLead.get(k)||{count:0,last:null};v.count++;if(!v.last)v.last=c;byLead.set(k,v);}
  const now=new Date();return leads.map(l=>{const c=byLead.get(String(l.id))||{};const follow=l.nextFollowupAt?new Date(l.nextFollowupAt):null;const priority=follow&&follow<now?1:follow&&follow-now<=15*60000?2:l.status?.code==='new'?3:c.last?.disposition==='no_answer'?4:5;return{id:l.id,name:l.contact?.name,phone:l.contact?.phone,course:l.courseInterested,status:l.status,lastCallResult:c.last?.disposition||null,lastContactedAt:c.last?.endedAt||null,nextFollowupAt:l.nextFollowupAt,callAttemptCount:c.count||0,priority};}).sort((a,b)=>a.priority-b.priority||new Date(a.nextFollowupAt||8640000000000000)-new Date(b.nextFollowupAt||8640000000000000));
 }
 async start(payload,actor,requestContext={},transaction=null){
  if(!actor?.isSystemAdmin&&!actor?.permissions?.includes('calls.create'))throw fail('CALL_CREATE_FORBIDDEN','You cannot create calls.',403);
  if(!payload?.leadId)throw fail('VALIDATION_FAILED','Lead is required.',422);
  if(payload.method&&!['manual','mobile_manual'].includes(payload.method))throw fail('VALIDATION_FAILED','Call method must be manual.',422);
  const run=async t=>{
   const context={requestId:requestContext.requestId||null,transactionId:crypto.randomUUID()};
   const lead=await operation(context,'lock_lead',()=>db.Lead.findByPk(payload.leadId,{transaction:t,lock:t.LOCK.UPDATE}));if(!lead)throw fail('LEAD_NOT_FOUND','Lead not found.',404);
   if(!own(actor,lead.ownerId))throw fail('CALL_LEAD_FORBIDDEN','You cannot call this lead.',403);
   const contact=await operation(context,'load_lead_contact',()=>db.Contact.findByPk(lead.contactId,{attributes:['id','phone'],transaction:t}));if(!contact||!validPhone(contact.phone))throw fail('CALL_PHONE_INVALID','This lead does not have a valid phone number.',422);
   const existing=await operation(context,'check_active_call',()=>db.CallActivity.findOne({where:{agentUserId:actor.id,endedAt:null},transaction:t,lock:t.LOCK.UPDATE}));if(existing)throw fail('ACTIVE_CALL_EXISTS','Finish your active call first.',409);
   if(payload.idempotencyKey){const duplicate=await operation(context,'check_call_idempotency',()=>db.CallActivity.findOne({where:{idempotencyKey:payload.idempotencyKey},transaction:t}));if(duplicate)return duplicate;}
   const row=await operation(context,'create_call_activity',()=>db.CallActivity.create({leadId:lead.id,contactId:contact.id,agentUserId:actor.id,whatsappAccountId:lead.whatsappAccountId,direction:'outbound',method:'mobile_manual',verificationSource:'agent_reported',startedAt:new Date(),previousStatusId:lead.statusId,idempotencyKey:payload.idempotencyKey||null,attributionKey:`call:${crypto.randomUUID()}`},{transaction:t}));
   await operation(context,'create_call_started_activity',()=>db.LeadActivity.create({leadId:lead.id,actorUserId:actor.id,activityType:'CALL_STARTED',action:'CALL_STARTED',newValue:{callActivityId:row.id,method:row.method},note:'Agent started a reported call.',createdAt:new Date()},{transaction:t}));return row;
  };return transaction?run(transaction):db.sequelize.transaction(run);
 }
 async complete(id,payload,actor,transaction=null,requestContext={}){
  const run=async t=>{
   const context={requestId:requestContext.requestId||null,transactionId:requestContext.transactionId||crypto.randomUUID()};
   const call=await operation(context,'lock_call_activity',()=>db.CallActivity.findByPk(id,{transaction:t,lock:t.LOCK.UPDATE}));if(!call)throw fail('CALL_NOT_FOUND','Call not found.',404);if(!own(actor,call.agentUserId))throw fail('CALL_UPDATE_FORBIDDEN','You cannot complete this call.',403);if(call.endedAt)return call;
   const status=await operation(context,'resolve_new_lead_status',()=>db.LeadStatus.findOne({where:{id:payload.newStatusId,active:true},transaction:t}));if(!status)throw fail('INVALID_LEAD_STATUS','Select a valid lead status.');
   const resultCode=dispositionCode(payload.disposition),expectedStatus=dispositionStatuses[resultCode];if(!expectedStatus)throw fail('CALL_DISPOSITION_REQUIRED','Select a valid call result.',422);
   if(String(status.code)!==expectedStatus)throw Object.assign(fail('CALL_STATUS_MISMATCH','Validation failed',422),{errors:{newStatusId:`${clean(payload.disposition)} calls must use the ${expectedStatus.replace(/_/g,' ')} status.`}});
   const currentStatus=await operation(context,'load_previous_lead_status',()=>db.LeadStatus.findByPk(call.previousStatusId,{transaction:t}));const allowed=Array.isArray(currentStatus?.allowedNextStatusIds)?currentStatus.allowedNextStatusIds:[];if(allowed.length&&!allowed.map(String).includes(String(payload.newStatusId)))throw fail('LEAD_STATUS_TRANSITION_INVALID','This status transition is not allowed.');
   if(status.reasonRequired&&!String(payload.reason||'').trim())throw fail('CALL_REASON_REQUIRED','Reason is required.');
   if(status.followupRequired&&!payload.nextFollowUpAt)throw fail('FOLLOWUP_DUE_REQUIRED','Follow-up date and time are required.');
   if(!payload.disposition)throw fail('CALL_DISPOSITION_REQUIRED','Call result is required.');
   const now=new Date(),duration=Math.max(0,Math.floor((now-new Date(call.startedAt))/1000));
   await operation(context,'complete_call_activity',()=>call.update({endedAt:now,durationSeconds:duration,talkTimeSeconds:Math.min(duration,Math.max(0,Number(payload.talkTimeSeconds||0))),disposition:resultCode,newStatusId:status.id,notes:payload.notes||null,nextFollowupAt:payload.nextFollowUpAt||null},{transaction:t}));
   const previous=await operation(context,'load_latest_status_history',()=>db.LeadStatusHistory.findOne({where:{leadId:call.leadId},order:[['changed_at','DESC']],transaction:t}));
   await operation(context,'change_canonical_lead_status',()=>leadStatusService.changeStatus({leadId:call.leadId,statusId:status.id,actor,source:'call_result',transaction:t,auditData:{callActivityId:call.id,reason:payload.reason||null}}));
   await operation(context,'create_immutable_status_history',()=>db.LeadStatusHistory.create({leadId:call.leadId,fromStatusId:call.previousStatusId,toStatusId:status.id,changedByUserId:actor.id,changedAt:now,durationInPreviousStatusSeconds:previous?Math.max(0,Math.floor((now-new Date(previous.changedAt))/1000)):null,reason:payload.reason||null,source:'call_result',callActivityId:call.id},{transaction:t}));
   if(payload.nextFollowUpAt)await operation(context,'create_call_followup',()=>db.Followup.create({leadId:call.leadId,contactId:call.contactId,assignedTo:actor.id,createdByUserId:actor.id,dueDate:payload.nextFollowUpAt,status:'pending',priority:'normal',followupType:'call',note:payload.notes||null},{transaction:t}));
   if(status.countsAsConversion||status.code==='registered'){const attributionKey=conversionAttributionKey(call.leadId,call.courseId);await operation(context,'upsert_conversion_attribution',()=>db.ConversionAttribution.findOrCreate({where:{attributionKey},defaults:{leadId:call.leadId,courseId:call.courseId||null,originalOwnerUserId:actor.id,convertingUserId:actor.id,convertedAt:now,attributionMethod:'call_result',callActivityId:call.id},transaction:t}));}
   await operation(context,'create_call_completion_audit',()=>audit.record({userId:actor.id,action:'CALL_COMPLETED',entityType:'call_activity',entityId:call.id,changes:{disposition:resultCode,newStatusId:status.id},transaction:t,required:true}));
   await operation(context,'complete_queue_entry',()=>db.CallQueueEntry.update({status:'completed',completedAt:now},{where:{lastCallActivityId:call.id,status:'calling'},transaction:t}));return call;
  };
  return transaction?run(transaction):db.sequelize.transaction(run);
 }
 async log(payload,actor,requestContext={}){
  if(!actor?.isSystemAdmin&&!actor?.permissions?.includes('calls.create'))throw fail('CALL_CREATE_FORBIDDEN','You cannot create calls.',403);
  if(!payload?.leadId)throw fail('VALIDATION_FAILED','Lead is required.',422);
  return db.sequelize.transaction(async t=>{
   const context={requestId:requestContext.requestId||null,transactionId:crypto.randomUUID()};
   const lead=await operation(context,'lock_lead',()=>db.Lead.findByPk(payload.leadId,{transaction:t,lock:t.LOCK.UPDATE}));if(!lead)throw fail('LEAD_NOT_FOUND','Lead not found.',404);
   if(!own(actor,lead.ownerId))throw fail('CALL_LEAD_FORBIDDEN','You cannot call this lead.',403);
   const contact=await operation(context,'load_lead_contact',()=>db.Contact.findByPk(lead.contactId,{attributes:['id','phone'],transaction:t}));if(!contact||!validPhone(contact.phone))throw fail('CALL_PHONE_INVALID','This lead does not have a valid phone number.',422);
   if(payload.idempotencyKey){const duplicate=await operation(context,'check_call_idempotency',()=>db.CallActivity.findOne({where:{idempotencyKey:payload.idempotencyKey},transaction:t}));if(duplicate)return duplicate;}
   const row=await operation(context,'create_completed_call_activity',()=>db.CallActivity.create({leadId:lead.id,contactId:contact.id,agentUserId:actor.id,whatsappAccountId:lead.whatsappAccountId,direction:'outbound',method:'mobile_manual',verificationSource:'agent_reported',startedAt:new Date(),previousStatusId:lead.statusId,idempotencyKey:payload.idempotencyKey||null,attributionKey:`call:${crypto.randomUUID()}`},{transaction:t}));
   return this.complete(row.id,payload,actor,t,context);
  });
 }
 async dashboard(query,actor){
  const where={endedAt:{[Op.ne]:null}},range=periodRange(query.period);where.startedAt=query.from||query.to?{...(query.from?{[Op.gte]:new Date(`${query.from}T00:00:00+05:30`)}:{}),...(query.to?{[Op.lt]:new Date(new Date(`${query.to}T00:00:00+05:30`).getTime()+86400000)}:{})}:{[Op.gte]:range.start,[Op.lt]:range.end};if(!actor.isSystemAdmin&&!actor.permissions?.includes('calls.view.team'))where.agentUserId=actor.id;
  const calls=await db.CallActivity.findAll({where,attributes:['id','leadId','agentUserId','disposition','durationSeconds','talkTimeSeconds','startedAt'],order:[['started_at','DESC']],limit:500});
  const attempted=new Set(calls.map(x=>String(x.leadId))),answered=calls.filter(x=>['answered','interested','registered','call_back_later'].includes(String(x.disposition).toLowerCase()));
  const conversions=await db.ConversionAttribution.count({where:{leadId:{[Op.in]:[...attempted]}}});return{totals:{callAttempts:calls.length,uniqueLeadsContacted:attempted.size,answeredCalls:answered.length,conversions,contactRate:attempted.size?Math.round(new Set(answered.map(x=>String(x.leadId))).size/attempted.size*100):0,averageTalkTime:answered.length?Math.round(answered.reduce((s,x)=>s+Number(x.talkTimeSeconds||0),0)/answered.length):0},recentCalls:calls.slice(0,20),definitions:{contactRate:'Unique answered leads / unique attempted leads',conversionRate:'Converted unique leads / eligible assigned leads'}};}
 async timeline(leadId){return db.LeadActivity.findAll({where:{leadId},order:[['created_at','DESC']],limit:200});}
}
module.exports=new CallCenterService();
