const {Op,literal}=require('sequelize');
const db=require('../models');
const labelService=require('./label.service');
const whatsappAccess=require('./whatsappAccountAccess.service');
const socket=require('./socket.service');

const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status,exposeMessage:true});
const ids=value=>{
 if(value===undefined)return null;
 if(!Array.isArray(value)||value.some(id=>!/^\d+$/.test(String(id))))throw fail('LABEL_IDS_INVALID','Label IDs must be an array of numeric IDs.',422);
 return[...new Set(value.map(Number))];
};
const actorName=actor=>[actor?.firstName,actor?.lastName].filter(Boolean).join(' ')||actor?.email||`User ${actor?.id}`;

class LeadLabelService{
 async canonicalConversation(lead,transaction){
  return db.Conversation.findOne({
   where:{[Op.or]:[{leadId:lead.id},{contactId:lead.contactId}]},
   order:[
    [literal("CASE WHEN status IN ('open','pending') THEN 0 ELSE 1 END"),'ASC'],
    [literal(`CASE WHEN lead_id = ${Number(lead.id)} THEN 0 ELSE 1 END`),'ASC'],
    ['updatedAt','DESC']
   ],
   transaction
  });
 }

 async getForLead(leadId,transaction=null){
  const lead=await db.Lead.findByPk(leadId,{attributes:['id','contactId'],transaction});
  if(!lead)return[];
  const conversation=await this.canonicalConversation(lead,transaction);
  if(!conversation)return[];
  const links=await db.ConversationLabel.findAll({where:{conversationId:conversation.id},attributes:['labelId'],transaction});
  const labelIds=links.map(row=>row.labelId);
  return labelIds.length?db.Label.findAll({where:{id:{[Op.in]:labelIds}},order:[['name','ASC']],transaction}):[];
 }

 async patchAfterCall({leadId,callActivityId,actor,addLabelIds,removeLabelIds,requestId=null,transaction}){
  const add=ids(addLabelIds),remove=ids(removeLabelIds);
  if(add===null&&remove===null)return null;
  const additions=add||[],removals=remove||[];
  if(additions.some(id=>removals.includes(id)))throw fail('LABEL_PATCH_CONFLICT','A label cannot be added and removed in the same request.',422);
  if(additions.length)labelService.assertPermission(actor,'labels.assign');
  if(removals.length)labelService.assertPermission(actor,'labels.remove');
  const requested=[...new Set([...additions,...removals])];
  const labels=requested.length?await db.Label.findAll({where:{id:{[Op.in]:requested}},transaction}):[];
  if(labels.length!==requested.length)throw fail('LABEL_NOT_FOUND','One or more labels do not exist in the canonical label set.',422);

  const lead=await db.Lead.findByPk(leadId,{attributes:['id','contactId','whatsappAccountId'],transaction,lock:transaction.LOCK.UPDATE});
  if(!lead)throw fail('LEAD_NOT_FOUND','Lead not found.',404);
  if(!actor?.isSystemAdmin&&lead.whatsappAccountId)await whatsappAccess.assertAccess(lead.whatsappAccountId,actor.id);
  const conversation=await this.canonicalConversation(lead,transaction);
  if(!conversation)throw fail('CANONICAL_CONVERSATION_MISSING','Labels require a canonical conversation for this lead.',422);
  if(lead.whatsappAccountId&&conversation.whatsappAccountId&&String(lead.whatsappAccountId)!==String(conversation.whatsappAccountId))throw fail('CANONICAL_CONVERSATION_ACCOUNT_MISMATCH',"The canonical conversation does not belong to the lead's WhatsApp account.",409);

  const current=await db.ConversationLabel.findAll({where:{conversationId:conversation.id},attributes:['labelId'],transaction,lock:transaction.LOCK.UPDATE});
  const currentIds=new Set(current.map(row=>Number(row.labelId)));
  const added=additions.filter(id=>!currentIds.has(id));
  const removed=removals.filter(id=>currentIds.has(id));
  for(const labelId of added)await db.ConversationLabel.findOrCreate({where:{conversationId:conversation.id,labelId},defaults:{conversationId:conversation.id,labelId},transaction});
  if(removed.length)await db.ConversationLabel.destroy({where:{conversationId:conversation.id,labelId:{[Op.in]:removed}},transaction});

  const byId=new Map(labels.map(label=>[Number(label.id),label]));
  const changedAt=new Date();
  for(const labelId of added)await db.LeadActivity.create({leadId:lead.id,actorUserId:actor.id,activityType:'LABEL_ADDED',action:'LABEL_ADDED',oldValue:null,newValue:{labelId,callActivityId,source:'call_center_after_call',requestId},note:`${actorName(actor)} added label ${byId.get(labelId)?.name||labelId} after the call.`,createdAt:changedAt},{transaction});
  for(const labelId of removed)await db.LeadActivity.create({leadId:lead.id,actorUserId:actor.id,activityType:'LABEL_REMOVED',action:'LABEL_REMOVED',oldValue:{labelId},newValue:{callActivityId,source:'call_center_after_call',requestId},note:`${actorName(actor)} removed label ${byId.get(labelId)?.name||labelId} after the call.`,createdAt:changedAt},{transaction});

  const finalIds=[...new Set([...currentIds,...added].filter(id=>!removed.includes(id)))].sort((a,b)=>a-b);
  const change={leadId:lead.id,contactId:lead.contactId,conversationId:conversation.id,whatsappAccountId:conversation.whatsappAccountId,labelIds:finalIds,addedLabelIds:added,removedLabelIds:removed,callActivityId};
  const emit=()=>Promise.resolve(socket.emit('crm.labels.changed',change)).catch(()=>null);
  if(typeof transaction.afterCommit==='function')transaction.afterCommit(()=>setImmediate(emit));
  return change;
 }
}

module.exports=new LeadLabelService();
