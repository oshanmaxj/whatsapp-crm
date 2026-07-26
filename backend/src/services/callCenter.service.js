const { Op, fn, col }=require('sequelize');
const db=require('../models');
const leadStatusService=require('./leadStatus.service');
const audit=require('./audit.service');
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,message,status,exposeMessage:true});
const own=(actor,id)=>actor?.isSystemAdmin||actor?.permissions?.includes('calls.view.team')||String(actor?.id)===String(id);
class CallCenterService{
 async start(payload,actor){
  if(!actor?.isSystemAdmin&&!actor?.permissions?.includes('calls.create'))throw fail('CALL_CREATE_FORBIDDEN','You cannot create calls.',403);
  return db.sequelize.transaction(async t=>{
   const lead=await db.Lead.findByPk(payload.leadId,{transaction:t,lock:t.LOCK.UPDATE});if(!lead)throw fail('LEAD_NOT_FOUND','Lead not found.',404);
   if(!own(actor,lead.ownerId))throw fail('CALL_LEAD_FORBIDDEN','You cannot call this lead.',403);
   const existing=await db.CallActivity.findOne({where:{agentUserId:actor.id,endedAt:null},transaction:t,lock:t.LOCK.UPDATE});if(existing)throw fail('ACTIVE_CALL_EXISTS','Finish your active call first.',409);
   if(payload.idempotencyKey){const duplicate=await db.CallActivity.findOne({where:{idempotencyKey:payload.idempotencyKey},transaction:t});if(duplicate)return duplicate;}
   const row=await db.CallActivity.create({leadId:lead.id,contactId:lead.contactId,agentUserId:actor.id,whatsappAccountId:lead.whatsappAccountId,direction:payload.direction||'outbound',method:payload.method||'mobile_manual',verificationSource:'agent_reported',startedAt:new Date(),previousStatusId:lead.statusId,idempotencyKey:payload.idempotencyKey||null},{transaction:t});
   await db.LeadActivity.create({leadId:lead.id,actorUserId:actor.id,activityType:'CALL_STARTED',action:'CALL_STARTED',newValue:{callActivityId:row.id,method:row.method},note:'Agent started a reported call.',createdAt:new Date()},{transaction:t});return row;
  });
 }
 async complete(id,payload,actor){
  return db.sequelize.transaction(async t=>{
   const call=await db.CallActivity.findByPk(id,{transaction:t,lock:t.LOCK.UPDATE});if(!call)throw fail('CALL_NOT_FOUND','Call not found.',404);if(!own(actor,call.agentUserId))throw fail('CALL_UPDATE_FORBIDDEN','You cannot complete this call.',403);if(call.endedAt)return call;
   const status=await db.LeadStatus.findOne({where:{id:payload.newStatusId,active:true},transaction:t});if(!status)throw fail('INVALID_LEAD_STATUS','Select a valid lead status.');
   const currentStatus=await db.LeadStatus.findByPk(call.previousStatusId,{transaction:t});const allowed=Array.isArray(currentStatus?.allowedNextStatusIds)?currentStatus.allowedNextStatusIds:[];if(allowed.length&&!allowed.map(String).includes(String(payload.newStatusId)))throw fail('LEAD_STATUS_TRANSITION_INVALID','This status transition is not allowed.');
   if(status.reasonRequired&&!String(payload.reason||'').trim())throw fail('CALL_REASON_REQUIRED','Reason is required.');
   if(status.followupRequired&&!payload.nextFollowUpAt)throw fail('FOLLOWUP_DUE_REQUIRED','Follow-up date and time are required.');
   if(!payload.disposition)throw fail('CALL_DISPOSITION_REQUIRED','Call result is required.');
   const now=new Date(),duration=Math.max(0,Math.floor((now-new Date(call.startedAt))/1000));
   await call.update({endedAt:now,durationSeconds:duration,talkTimeSeconds:Math.min(duration,Math.max(0,Number(payload.talkTimeSeconds||0))),disposition:payload.disposition,newStatusId:status.id,notes:payload.notes||null,nextFollowupAt:payload.nextFollowUpAt||null},{transaction:t});
   const previous=await db.LeadStatusHistory.findOne({where:{leadId:call.leadId},order:[['changed_at','DESC']],transaction:t});
   await leadStatusService.changeStatus({leadId:call.leadId,statusId:status.id,actor,source:'call_result',transaction:t,auditData:{callActivityId:call.id,reason:payload.reason||null}});
   await db.LeadStatusHistory.create({leadId:call.leadId,fromStatusId:call.previousStatusId,toStatusId:status.id,changedByUserId:actor.id,changedAt:now,durationInPreviousStatusSeconds:previous?Math.max(0,Math.floor((now-new Date(previous.changedAt))/1000)):null,reason:payload.reason||null,source:'call_result',callActivityId:call.id},{transaction:t});
   if(payload.nextFollowUpAt)await db.Followup.create({leadId:call.leadId,contactId:call.contactId,assignedTo:actor.id,createdByUserId:actor.id,dueDate:payload.nextFollowUpAt,status:'pending',priority:'normal',followupType:'call',note:payload.notes||null},{transaction:t});
   if(status.countsAsConversion||status.code==='registered'){const attributionKey=`${call.leadId}:${call.courseId||'unspecified'}`;await db.ConversionAttribution.findOrCreate({where:{attributionKey},defaults:{leadId:call.leadId,courseId:call.courseId||null,originalOwnerUserId:actor.id,convertingUserId:actor.id,convertedAt:now,attributionMethod:'call_result',callActivityId:call.id},transaction:t});}
   await audit.record({userId:actor.id,action:'CALL_COMPLETED',entityType:'call_activity',entityId:call.id,changes:{disposition:payload.disposition,newStatusId:status.id},transaction:t,required:true});return call;
  });
 }
 async log(payload,actor){const row=await this.start(payload,actor);return this.complete(row.id,payload,actor);}
 async dashboard(query,actor){
  const where={endedAt:{[Op.ne]:null}};if(query.from||query.to)where.startedAt={...(query.from?{[Op.gte]:new Date(query.from)}:{}),...(query.to?{[Op.lte]:new Date(query.to)}:{})};if(!actor.isSystemAdmin&&!actor.permissions?.includes('calls.view.team'))where.agentUserId=actor.id;
  const calls=await db.CallActivity.findAll({where,attributes:['id','leadId','agentUserId','disposition','durationSeconds','talkTimeSeconds','startedAt'],order:[['started_at','DESC']],limit:500});
  const attempted=new Set(calls.map(x=>String(x.leadId))),answered=calls.filter(x=>['answered','interested','registered','call_back_later'].includes(String(x.disposition).toLowerCase()));
  const conversions=await db.ConversionAttribution.count({where:{leadId:{[Op.in]:[...attempted]}}});return{totals:{callAttempts:calls.length,uniqueLeadsContacted:attempted.size,answeredCalls:answered.length,conversions,contactRate:attempted.size?Math.round(new Set(answered.map(x=>String(x.leadId))).size/attempted.size*100):0,averageTalkTime:answered.length?Math.round(answered.reduce((s,x)=>s+Number(x.talkTimeSeconds||0),0)/answered.length):0},recentCalls:calls.slice(0,20),definitions:{contactRate:'Unique answered leads / unique attempted leads',conversionRate:'Converted unique leads / eligible assigned leads'}};}
 async timeline(leadId){return db.LeadActivity.findAll({where:{leadId},order:[['created_at','DESC']],limit:200});}
}
module.exports=new CallCenterService();
