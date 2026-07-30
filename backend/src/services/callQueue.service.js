const crypto=require('crypto');
const {Op}=require('sequelize');
const db=require('../models');
const leadService=require('./lead.service');
const callCenter=require('./callCenter.service');
const conversationAccess=require('./conversationAccess.service');
const audit=require('./audit.service');
const logger=require('../config/logger');

const fail=(code,message,status=400,errors)=>Object.assign(new Error(message),{code,status,errors,exposeMessage:true});
const activeStatuses=['pending','calling','snoozed'];
const batchSize=250;
const can=(actor,permission)=>actor?.isSystemAdmin||actor?.permissions?.includes(permission);
const originalError=error=>{let value=error,seen=new Set();while(value&&!seen.has(value)){seen.add(value);const next=value.original||value.parent||value.cause;if(!next||next===value)break;value=next;}return value||error;};
const safeMessage=(error,reason)=>error?.exposeMessage&&error?.message?error.message:reason==='DATABASE_CONSTRAINT'?'The queue entry conflicts with a database rule. Please retry or contact an administrator.':'An internal error prevented this lead from being added. Please provide the request ID to an administrator.';

const reasonFor=error=>{
 const mapped={
  LEAD_NOT_FOUND:'LEAD_NOT_VISIBLE',
  CALL_QUEUE_LEAD_NOT_VISIBLE:'LEAD_NOT_VISIBLE',
  CALL_QUEUE_ACCOUNT_FORBIDDEN:'WHATSAPP_ACCOUNT_NOT_PERMITTED',
  CALL_QUEUE_UNASSIGNED_FORBIDDEN:'NOT_ASSIGNED_TO_AGENT',
  CALL_QUEUE_OTHER_OWNER_FORBIDDEN:'NOT_ASSIGNED_TO_AGENT',
  CALL_QUEUE_TERMINAL:'LEAD_STATUS_NOT_ELIGIBLE',
  CALL_QUEUE_INACTIVE:'LEAD_STATUS_NOT_ELIGIBLE',
  CALL_QUEUE_MISSING_PHONE:'MISSING_PHONE',
  CALL_QUEUE_CAPACITY:'QUEUE_CAPACITY_REACHED',
  CALL_QUEUE_FORBIDDEN:'PERMISSION_DENIED',
  CALL_QUEUE_DEFAULT_MISSING:'DEFAULT_QUEUE_MISSING',
  CALL_QUEUE_OWNER_MISMATCH:'QUEUE_NOT_OWNED_BY_AGENT'
 };
 if(mapped[error?.code])return mapped[error.code];
 const database=originalError(error),sqlState=String(database?.code||'');
 if(error?.name?.includes('UniqueConstraint')||error?.name?.includes('DatabaseError')||/^23/.test(sqlState))return'DATABASE_CONSTRAINT';
 return error?.status===403?'PERMISSION_DENIED':'INTERNAL_ERROR';
};

class CallQueueService{
 async queue(actor,transaction=null){
  try{
   let row=await db.CallQueue.findOne({where:{agentUserId:actor.id,isDefault:true},transaction,...(transaction?{lock:transaction.LOCK.UPDATE}:{})});
   if(row){
    if(String(row.agentUserId)!==String(actor.id))throw fail('CALL_QUEUE_OWNER_MISMATCH','The selected default queue is not owned by the authenticated agent.',409);
    if(row.status!=='active')row=await row.update({status:'active'},{transaction});
    return row;
   }
   [row]=await db.CallQueue.findOrCreate({where:{agentUserId:actor.id,isDefault:true},defaults:{agentUserId:actor.id,name:'My Queue',status:'active',isDefault:true},transaction});
   if(!row)throw fail('CALL_QUEUE_DEFAULT_MISSING','No active default queue is available for this agent.',409);
   return row;
  }catch(error){
   if(String(error.code||'').startsWith('CALL_QUEUE_'))throw error;
   throw Object.assign(fail('CALL_QUEUE_DEFAULT_MISSING','The agent’s default queue could not be provisioned.',500),{cause:error});
  }
 }

 async search(query,actor){
  const result=await leadService.listLeads(query,actor),ids=result.leads.map(row=>row.id);
  const calls=ids.length?await db.CallActivity.findAll({where:{leadId:{[Op.in]:ids},endedAt:{[Op.ne]:null}},order:[['started_at','DESC']],attributes:['leadId','disposition','endedAt']}):[];
  const queue=await this.queue(actor),queued=ids.length?await db.CallQueueEntry.findAll({where:{queueId:queue.id,leadId:{[Op.in]:ids},status:{[Op.in]:activeStatuses}},attributes:['leadId','status']}):[];
  const byLead=new Map(),queuedByLead=new Map(queued.map(row=>[String(row.leadId),row.status]));
  for(const call of calls){const key=String(call.leadId),value=byLead.get(key)||{attempts:0,lastResult:null,lastContactedAt:null};value.attempts++;if(!value.lastResult){value.lastResult=call.disposition;value.lastContactedAt=call.endedAt;}byLead.set(key,value);}
  const leads=await Promise.all(result.leads.map(async row=>({...row,...(byLead.get(String(row.id))||{attempts:0,lastResult:null,lastContactedAt:null}),queueState:queuedByLead.get(String(row.id))||null,conversations:await this.conversations({id:row.id,contactId:row.contact?.id},actor)})));
  return{...result,leads};
 }

 async assertEligible(leadId,actor,transaction=null,lock=false){
  if(lock){
   const locked=await db.Lead.findByPk(leadId,{attributes:['id'],transaction,lock:transaction.LOCK.UPDATE});
   if(!locked)throw fail('LEAD_NOT_FOUND','Lead not found or not visible.',404);
  }
  const lead=await db.Lead.findByPk(leadId,{include:[{model:db.LeadStatus,as:'status'},{model:db.Contact,as:'contact'},{model:db.User,as:'owner',attributes:['id','firstName','lastName']}],transaction});
  if(!lead)throw fail('LEAD_NOT_FOUND','Lead not found.',404);
  if(!actor?.isSystemAdmin){
   const accountWhere=await require('./whatsappAccountAccess.service').whereForUser(actor.id,'whatsappAccountId');
   const allowed=await db.Lead.count({where:{id:lead.id,...accountWhere},transaction});
   if(!allowed)throw fail('CALL_QUEUE_ACCOUNT_FORBIDDEN','You do not have access to this lead’s WhatsApp account.',403);
  }
  if(lead.status?.active===false)throw fail('CALL_QUEUE_INACTIVE','Inactive leads cannot be queued.',422);
  if(lead.status?.terminal||lead.status?.countsAsConversion)throw fail('CALL_QUEUE_TERMINAL','Converted or terminal leads cannot be queued.',422);
  if(!String(lead.contact?.phone||'').trim())throw fail('CALL_QUEUE_MISSING_PHONE','The lead has no phone number.',422);
  if(lead.ownerId==null&&!can(actor,'leads.call_unassigned'))throw fail('CALL_QUEUE_UNASSIGNED_FORBIDDEN','Permission to call unassigned leads is required.',403);
  if(lead.ownerId!=null&&String(lead.ownerId)!==String(actor.id)&&!can(actor,'leads.call_others')&&!can(actor,'lead.view_all')&&!can(actor,'lead.view_team')){const owner=[lead.owner?.firstName,lead.owner?.lastName].filter(Boolean).join(' ')||'another agent';throw fail('CALL_QUEUE_OTHER_OWNER_FORBIDDEN',`The lead is assigned to ${owner}.`,403);}
  return lead;
 }

 summary(results,queue,operationId,requestId){
  const reasons={};
  for(const item of results)if(item.status==='rejected')reasons[item.reasonCode]=(reasons[item.reasonCode]||0)+1;
  return{operationId,requestId,requested:results.length,added:results.filter(x=>x.status==='added').length,alreadyInQueue:results.filter(x=>x.status==='already_queued').length,rejected:results.filter(x=>x.status==='rejected').length,reasons,results,queueId:queue?.id??null,capacity:queue?.capacity??null};
 }

 async addBatch(ids,actor,options,operationId,requestId){
  const results=[];
  for(const leadId of ids){
   const trace={requestId,operationId,actorUserId:actor.id,effectivePermissions:[...(actor.permissions||[])].sort(),leadId,queueId:null,queueOwnerUserId:null,leadOwnerUserId:null,tenantId:null,departmentId:null,whatsappAccountId:null,statusCode:null,activeQueueEntry:null,checks:[]};
   try{
    const result=await db.sequelize.transaction(async transaction=>{
     const queue=await this.queue(actor,transaction);
     trace.queueId=queue.id;trace.queueOwnerUserId=queue.agentUserId;trace.checks.push({check:'default_queue_active_and_owned',passed:queue.status==='active'&&String(queue.agentUserId)===String(actor.id)});
     let position=Number(await db.CallQueueEntry.max('position',{where:{queueId:queue.id},transaction})||0);
     const existing=await db.CallQueueEntry.findOne({where:{queueId:queue.id,leadId,status:{[Op.in]:activeStatuses}},transaction});
     if(existing){trace.activeQueueEntry={entryId:existing.id,queueId:queue.id,scope:'own'};return{leadId,status:'already_queued',reasonCode:'ALREADY_IN_OWN_QUEUE',message:'Lead is already active in your queue.'};}
     const conflict=await db.CallQueueEntry.findOne({where:{leadId,status:{[Op.in]:activeStatuses}},include:[{model:db.CallQueue,as:'queue',attributes:['agentUserId']}],transaction});
     if(conflict&&String(conflict.queue?.agentUserId)!==String(actor.id)){trace.activeQueueEntry={entryId:conflict.id,queueId:conflict.queueId,scope:'another'};return{leadId,status:'rejected',reasonCode:'ACTIVE_IN_ANOTHER_QUEUE',message:'Lead is active in another agent’s queue.'};}
     const lead=await this.assertEligible(leadId,actor,transaction,true);
     trace.leadOwnerUserId=lead.ownerId;trace.whatsappAccountId=lead.whatsappAccountId;trace.statusCode=lead.status?.code||lead.stage;trace.checks.push({check:'lead_eligible',passed:true},{check:'canonical_owner_matches_actor_or_override',passed:lead.ownerId==null||String(lead.ownerId)===String(actor.id)||can(actor,'leads.call_others')},{check:'whatsapp_account_permitted',passed:true},{check:'phone_present',passed:true});
     if(queue.capacity!=null){
      const active=await db.CallQueueEntry.count({where:{queueId:queue.id,status:{[Op.in]:activeStatuses}},transaction});
      if(active>=queue.capacity)throw fail('CALL_QUEUE_CAPACITY','Your configured queue capacity has been reached.',409);
     }
     trace.checks.push({check:'queue_capacity',passed:true});
     await db.CallQueueEntry.create({queueId:queue.id,leadId,position:++position,priority:0,status:'pending',source:options.source,sourceFilter:options.sourceFilter,addedByUserId:actor.id,addedAt:new Date(),bulkOperationId:operationId},{transaction});
     return{leadId,status:'added',reasonCode:null,message:'Added to queue.',leadName:[lead.contact?.firstName,lead.contact?.lastName].filter(Boolean).join(' ')||null};
    });
    results.push(result);
    logger.info('call_queue_lead_decision',{...trace,result:{status:result.status,reasonCode:result.reasonCode}});
   }catch(error){
    const reasonCode=reasonFor(error),database=originalError(error);
    logger[reasonCode==='INTERNAL_ERROR'||reasonCode==='DATABASE_CONSTRAINT'?'error':'warn']('call_queue_lead_rejected',{...trace,result:{status:'rejected',reasonCode},error:{applicationCode:error.code||null,sqlState:database.code||null,table:database.table||null,column:database.column||null,constraint:database.constraint||null,message:String(database.message||error.message||'').slice(0,500)}});
    results.push({leadId,status:'rejected',reasonCode,message:safeMessage(error,reasonCode)});
   }
  }
  return results;
 }

 async add(leadIds,actor,{source='manual',sourceFilter=null,operationId=null,requestId=null}={}){
  if(!can(actor,'call_queue.manage_own'))throw fail('CALL_QUEUE_FORBIDDEN','Queue management permission is required.',403);
  const submitted=(leadIds||[]).map(Number).filter(Number.isInteger),seen=new Set(),duplicates=[];
  const ids=submitted.filter(id=>seen.has(id)?(duplicates.push(id),false):(seen.add(id),true));
  if(!ids.length)throw fail('VALIDATION_FAILED','Select at least one lead.',422,{leadIds:'Select at least one lead.'});
  const op=operationId||crypto.randomUUID(),req=requestId||crypto.randomUUID(),all=[];
  for(let offset=0;offset<ids.length;offset+=batchSize)all.push(...await this.addBatch(ids.slice(offset,offset+batchSize),actor,{source,sourceFilter},op,req));
  duplicates.forEach(leadId=>all.push({leadId,status:'rejected',reasonCode:'DUPLICATE_SUBMISSION',message:'Lead was submitted more than once.'}));
  let queue=null;try{queue=await this.queue(actor);}catch(error){if(!all.every(item=>item.reasonCode==='DEFAULT_QUEUE_MISSING'))throw error;}
  const result=this.summary(all,queue,op,req);
  logger.info('call_queue_bulk_add_completed',{requestId:req,operationId:op,actorUserId:actor.id,requested:result.requested,added:result.added,alreadyInQueue:result.alreadyInQueue,rejected:result.rejected,reasons:result.reasons});
  return result;
 }

 async addMatching(filters,actor,options={}){
  if(!can(actor,'call_queue.bulk_add'))throw fail('CALL_QUEUE_FORBIDDEN','Bulk queue permission is required.',403);
  const operationId=options.operationId||crypto.randomUUID(),requestId=options.requestId||crypto.randomUUID(),results=[];
  let page=1,total=0;
  do{
   const result=await leadService.listLeads({...filters,page,limit:100},actor);
   total=result.pagination.total;
   const ids=result.leads.map(row=>row.id);
   if(!ids.length)break;
   const part=await this.add(ids,actor,{source:'filtered_bulk',sourceFilter:filters,operationId,requestId});
   results.push(...part.results);
   page++;
  }while(results.length<total);
  let queue=null;try{queue=await this.queue(actor);}catch(error){if(!results.every(item=>item.reasonCode==='DEFAULT_QUEUE_MISSING'))throw error;}
  const summary=this.summary(results,queue,operationId,requestId);
  logger.info('call_queue_matching_add_completed',{requestId,operationId,actorUserId:actor.id,matched:total,added:summary.added,alreadyInQueue:summary.alreadyInQueue,rejected:summary.rejected,reasons:summary.reasons});
  return summary;
 }

 async list(actor){
  if(!can(actor,'call_queue.view_own'))throw fail('CALL_QUEUE_FORBIDDEN','Queue view permission is required.',403);
  const queue=await this.queue(actor),entries=await db.CallQueueEntry.findAll({where:{queueId:queue.id,status:{[Op.in]:activeStatuses}},include:[{model:db.Lead,as:'lead',include:[{model:db.Contact,as:'contact'},{model:db.LeadStatus,as:'status'},{model:db.LeadSource,as:'source'},{model:db.User,as:'owner',attributes:['id','firstName','lastName']}]}],order:[['priority','DESC'],['position','ASC']]});
  return{queue:{...queue.toJSON(),activeCount:entries.length},entries:await Promise.all(entries.map(row=>this.publicEntry(row,actor)))};
 }
 async conversations(lead,actor){const rows=await db.Conversation.findAll({where:{[Op.or]:[{leadId:lead.id},{leadId:null,contactId:lead.contactId}]},include:[{model:db.WhatsAppAccount,as:'whatsappAccount',attributes:['id','name','phoneNumber']},{model:db.User,as:'assignedUser',attributes:['id','firstName','lastName']}],order:[['last_message_at','DESC']]});const allowed=[];for(const row of rows){try{await conversationAccess.assertConversationAccess(row.id,actor.id);allowed.push(row);}catch(error){if(error.status!==403)throw error;}}return allowed.map(row=>({id:row.id,status:row.status,whatsappAccountId:row.whatsappAccountId,whatsappAccount:row.whatsappAccount?{id:row.whatsappAccount.id,name:row.whatsappAccount.name,phoneNumber:row.whatsappAccount.phoneNumber}:null,assignedAgent:row.assignedUser?{id:row.assignedUser.id,name:[row.assignedUser.firstName,row.assignedUser.lastName].filter(Boolean).join(' ')}:null,lastMessageAt:row.lastMessageAt,lastMessagePreview:String(row.lastMessage||'').slice(0,120)}));}
 async publicEntry(row,actor){const value=row.toJSON(),lead=row.lead,calls=await db.CallActivity.findAll({where:{leadId:row.leadId,endedAt:{[Op.ne]:null}},order:[['started_at','DESC']],attributes:['disposition','endedAt'],limit:50}),conversations=lead?await this.conversations(lead,actor):[];value.metrics={attempts:calls.length,lastResult:calls[0]?.disposition||null,lastContactedAt:calls[0]?.endedAt||null};value.conversations=conversations;return value;}
 async update(id,input,actor){const queue=await this.queue(actor),row=await db.CallQueueEntry.findOne({where:{id,queueId:queue.id,status:{[Op.in]:activeStatuses}}});if(!row)throw fail('CALL_QUEUE_ENTRY_NOT_FOUND','Queue entry not found.',404);const allowed={};if(['pending','skipped','snoozed','removed'].includes(input.status))allowed.status=input.status;if(input.priority!==undefined)allowed.priority=Math.max(-100,Math.min(100,Number(input.priority)||0));if(input.skipReason!==undefined)allowed.skipReason=String(input.skipReason||'').trim().slice(0,1000)||null;if(input.snoozedUntil!==undefined)allowed.snoozedUntil=input.snoozedUntil?new Date(input.snoozedUntil):null;if(allowed.status==='removed')allowed.completedAt=new Date();await row.update(allowed);await audit.record({userId:actor.id,action:'CALL_QUEUE_ENTRY_UPDATED',entityType:'call_queue_entry',entityId:id,changes:{fields:Object.keys(allowed)},required:true});return row;}
 async claimNext(actor,requestContext={},entryId=null){if(!can(actor,'call_queue.manage_own'))throw fail('CALL_QUEUE_FORBIDDEN','Queue management permission is required.',403);return db.sequelize.transaction(async transaction=>{const queue=await this.queue(actor,transaction),entry=await db.CallQueueEntry.findOne({where:{queueId:queue.id,...(entryId?{id:entryId}:{}),[Op.or]:[{status:'pending'},{status:'snoozed',snoozedUntil:{[Op.lte]:new Date()}}]},order:[['priority','DESC'],['position','ASC']],transaction,lock:transaction.LOCK.UPDATE,skipLocked:true});if(!entry)throw fail(entryId?'CALL_QUEUE_ENTRY_NOT_FOUND':'CALL_QUEUE_EMPTY',entryId?'Queue entry is no longer eligible.':'No eligible queue leads are ready.',entryId?404:409);await this.assertEligible(entry.leadId,actor,transaction,true);const call=await callCenter.start({leadId:entry.leadId,method:'manual',idempotencyKey:`queue-entry:${entry.id}:v${entry.version}`},actor,requestContext,transaction);await entry.update({status:'calling',claimedAt:new Date(),lastCallActivityId:call.id},{transaction});return{entry,call};});}
}
module.exports=new CallQueueService();
