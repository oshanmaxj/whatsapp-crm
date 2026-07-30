const crypto=require('crypto');
const {Op}=require('sequelize');
const db=require('../models');
const leads=require('./lead.service');
const assignment=require('./leadAssignment.service');
const accountAccess=require('./whatsappAccountAccess.service');
const logger=require('../config/logger');
const activeQueueStatuses=['pending','calling','snoozed'];
const has=(actor,p)=>actor?.isSystemAdmin||actor?.permissions?.includes(p);
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,message,status,exposeMessage:true});

class CallCenterBulkAssignmentService{
 permission(actor,lead,targetId){
  if(!has(actor,'leads.bulk_assign'))throw fail('PERMISSION_DENIED','Bulk assignment permission is required.',403);
  if(targetId==null&&!has(actor,'leads.unassign'))throw fail('PERMISSION_DENIED','Unassign permission is required.',403);
  if(lead.ownerId==null&&String(targetId)===String(actor.id)&&has(actor,'leads.assign_unassigned'))return;
  if(String(lead.ownerId||'')===String(actor.id||'')&&has(actor,'leads.assign_own'))return;
  if(has(actor,'leads.reassign_all')||has(actor,'leads.reassign_team'))return;
  throw fail('PERMISSION_DENIED','You cannot reassign this lead.',403);
 }
 async target(targetAgentUserId){
  if(targetAgentUserId==null)return null;
  const user=await db.User.findOne({where:{id:targetAgentUserId,status:'active'},attributes:['id','firstName','lastName','email','status','isSystemAdmin']});
  if(!user)throw fail('TARGET_AGENT_INACTIVE','Target agent is inactive or unavailable.',422);
  return user;
 }
 async moveQueue(lead,target,transaction){
  const entry=await db.CallQueueEntry.findOne({where:{leadId:lead.id,status:{[Op.in]:activeQueueStatuses}},transaction,lock:transaction.LOCK.UPDATE});
  if(!entry)return;
  if(!target)throw fail('ACTIVE_QUEUE_REQUIRES_TARGET','Unassigning requires the active queue entry to be removed first.',409);
  const[targetQueue]=await db.CallQueue.findOrCreate({where:{agentUserId:target.id,isDefault:true},defaults:{agentUserId:target.id,name:'My Queue',status:'active',isDefault:true},transaction});
  const duplicate=await db.CallQueueEntry.findOne({where:{queueId:targetQueue.id,leadId:lead.id,status:{[Op.in]:activeQueueStatuses}},transaction});
  if(duplicate&&String(duplicate.id)!==String(entry.id))throw fail('DUPLICATE_ACTIVE_QUEUE_ENTRY','Target queue already contains this lead.',409);
  if(targetQueue.capacity!=null){
   const count=await db.CallQueueEntry.count({where:{queueId:targetQueue.id,status:{[Op.in]:activeQueueStatuses}},transaction});
   if(count>=targetQueue.capacity)throw fail('QUEUE_CAPACITY_REACHED','Target queue capacity has been reached.',409);
  }
  const position=Number(await db.CallQueueEntry.max('position',{where:{queueId:targetQueue.id},transaction})||0)+1;
  await entry.update({queueId:targetQueue.id,position},{transaction});
 }
 async one(leadId,target,actor,input,operationId){
  try{
   let outcome;
   await db.sequelize.transaction(async transaction=>{
    const lead=await db.Lead.findByPk(leadId,{transaction,lock:transaction.LOCK.UPDATE});
    if(!lead)throw fail('INVALID_LEAD','Lead not found.',404);
    this.permission(actor,lead,target?.id??null);
    if(!actor.isSystemAdmin){
     const visible=await db.Lead.count({where:{id:lead.id,...await accountAccess.whereForUser(actor.id,'whatsappAccountId')},transaction});
     if(!visible)throw fail('LEAD_NOT_VISIBLE','Lead is outside your permitted scope.',403);
    }
    if(target&&!target.isSystemAdmin){
     const eligible=await db.Lead.count({where:{id:lead.id,...await accountAccess.whereForUser(target.id,'whatsappAccountId')},transaction});
     if(!eligible)throw fail('TARGET_AGENT_ACCOUNT_ACCESS_MISSING','Target agent cannot access the lead’s WhatsApp account.',422);
    }
    const previous=lead.ownerId;
    if(String(previous??'')===String(target?.id??'')){outcome={leadId,status:'unchanged',reasonCode:'ALREADY_ASSIGNED_TO_TARGET',message:'Lead is already assigned to the target agent.'};return;}
    if(!input.dryRun){
     if(input.moveQueueEntry!==false)await this.moveQueue(lead,target,transaction);
     const privileged={...actor,permissions:[...(actor.permissions||[]),'lead.assign','lead.reassign']};
     await assignment.assignAgent({leadId:lead.id,ownerId:target?.id??null,actor:privileged,source:'call_center_bulk_assign',reason:input.reason||'Call Center bulk assignment',transaction});
     await db.LeadAssignmentHistory.create({leadId:lead.id,previousAgentUserId:previous,newAgentUserId:target?.id??null,changedByUserId:actor.id,source:'call_center_bulk_assign',reason:input.reason||null,bulkOperationId:operationId,sourceMetadata:input.filters?{filters:input.filters}:{selection:'explicit'}},{transaction});
    }
    outcome={leadId,status:input.dryRun?'preview':'assigned',reasonCode:null,message:input.dryRun?'Eligible for assignment.':'Lead assigned.'};
   });
   return outcome;
  }catch(error){return{leadId,status:'rejected',reasonCode:error.code||'UNKNOWN',message:error.exposeMessage?error.message:'Lead could not be assigned.'};}
 }
 async ids(input,actor){
  const operationId=input.operationId||crypto.randomUUID(),target=await this.target(input.targetAgentUserId),submitted=(input.leadIds||[]).map(Number).filter(Number.isInteger),ids=[...new Set(submitted)];
  if(!ids.length)throw fail('VALIDATION_FAILED','Select at least one lead.',422);
  const results=[];
  for(let offset=0;offset<ids.length;offset+=100)for(const id of ids.slice(offset,offset+100))results.push(await this.one(id,target,actor,input,operationId));
  const response=this.summary(operationId,results,input.dryRun);
  logger.info('call_center_bulk_assignment_completed',{operationId,actorUserId:actor.id,dryRun:!!input.dryRun,requested:response.requested,assigned:response.assigned,unchanged:response.unchanged,rejected:response.rejected,reasons:response.reasons});
  return response;
 }
 async matching(input,actor){
  const operationId=input.operationId||crypto.randomUUID(),all=[],candidateIds=[];let page=1,total=0;
  do{const result=await leads.listLeads({...input.filters,page,limit:100},actor);total=result.pagination.total;if(!result.leads.length)break;candidateIds.push(...result.leads.map(x=>x.id));page++;}while(candidateIds.length<total);
  for(let offset=0;offset<candidateIds.length;offset+=100){const part=await this.ids({...input,operationId,leadIds:candidateIds.slice(offset,offset+100)},actor);all.push(...part.results);}
  return this.summary(operationId,all,input.dryRun);
 }
 summary(operationId,results,dryRun){const reasons={};results.filter(x=>x.reasonCode).forEach(x=>{reasons[x.reasonCode]=(reasons[x.reasonCode]||0)+1;});return{operationId,dryRun:!!dryRun,requested:results.length,assigned:results.filter(x=>['assigned','preview'].includes(x.status)).length,unchanged:results.filter(x=>x.status==='unchanged').length,rejected:results.filter(x=>x.status==='rejected').length,reasons,results};}
}
module.exports=new CallCenterBulkAssignmentService();
