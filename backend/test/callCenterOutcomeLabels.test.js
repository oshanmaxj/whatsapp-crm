const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const service=require('../src/services/leadLabel.service'),db=require('../src/models'),socket=require('../src/services/socket.service');
const labelService=require('../src/services/label.service');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

function environment(currentIds=[2]){
 const calls=[],activities=[];let afterCommit;
 const originals={
  lead:db.Lead.findByPk,conversation:db.Conversation.findOne,labelFind:db.Label.findAll,
  links:db.ConversationLabel.findAll,create:db.ConversationLabel.findOrCreate,destroy:db.ConversationLabel.destroy,
  activity:db.LeadActivity.create,emit:socket.emit,audience:socket.emitToConversationAudience
 };
 db.Lead.findByPk=async()=>({id:70,contactId:12,whatsappAccountId:3});
 db.Conversation.findOne=async options=>{calls.push(['conversation',options]);return{id:40,contactId:12,leadId:70,whatsappAccountId:3,status:'open'};};
 db.Label.findAll=async options=>(options.where.id[Object.getOwnPropertySymbols(options.where.id)[0]]||[]).map(id=>({id,name:`Label ${id}`,color:'#112233'}));
 db.ConversationLabel.findAll=async()=>currentIds.map(labelId=>({labelId}));
 db.ConversationLabel.findOrCreate=async options=>{calls.push(['add',options.where.labelId]);return[{},true];};
 db.ConversationLabel.destroy=async options=>{calls.push(['remove',options.where.labelId]);return 1;};
 db.LeadActivity.create=async payload=>{activities.push(payload);return payload;};
 socket.emit=()=>{};socket.emitToConversationAudience=async()=>{};
 return{
  transaction:{LOCK:{UPDATE:'UPDATE'},afterCommit(callback){afterCommit=callback;}},
  calls,activities,get afterCommit(){return afterCommit;},
  restore(){db.Lead.findByPk=originals.lead;db.Conversation.findOne=originals.conversation;db.Label.findAll=originals.labelFind;db.ConversationLabel.findAll=originals.links;db.ConversationLabel.findOrCreate=originals.create;db.ConversationLabel.destroy=originals.destroy;db.LeadActivity.create=originals.activity;socket.emit=originals.emit;socket.emitToConversationAudience=originals.audience;}
 };
}

test('omitted label patch preserves every existing label',async()=>{
 const env=environment();
 try{assert.equal(await service.patchAfterCall({leadId:70,callActivityId:8,actor:{id:9},transaction:env.transaction}),null);assert.equal(env.calls.length,0);}
 finally{env.restore();}
});

test('after-call patch adds multiple labels, removes one, and writes immutable history',async()=>{
 const env=environment([2,3]);
 try{
  const result=await service.patchAfterCall({leadId:70,callActivityId:8,actor:{id:9,firstName:'Nisansala',isSystemAdmin:true,permissions:['labels.assign','labels.remove']},addLabelIds:[4,5],removeLabelIds:[3],requestId:'req-labels',transaction:env.transaction});
  assert.deepEqual(result.labelIds,[2,4,5]);
  assert.deepEqual(env.calls.filter(x=>x[0]==='add').map(x=>x[1]),[4,5]);
  assert.equal(env.calls.filter(x=>x[0]==='remove').length,1);
  assert.deepEqual(env.activities.map(x=>x.action),['LABEL_ADDED','LABEL_ADDED','LABEL_REMOVED']);
  assert.ok(env.activities.every(x=>x.newValue.source==='call_center_after_call'&&x.newValue.callActivityId===8));
  assert.ok(env.activities[0].note.includes('Nisansala'));
  assert.equal(typeof env.afterCommit,'function');
 }finally{env.restore();}
});

test('explicit empty final set is represented by removals and requires remove permission',async()=>{
 const env=environment([2]);
 try{
  await assert.rejects(service.patchAfterCall({leadId:70,callActivityId:8,actor:{id:9,permissions:[]},addLabelIds:[],removeLabelIds:[2],transaction:env.transaction}),error=>error.status===403&&error.code==='LABEL_PERMISSION_DENIED');
 }finally{env.restore();}
});

test('invalid labels and conflicting patches are rejected before association writes',async()=>{
 const env=environment();
 try{
  await assert.rejects(service.patchAfterCall({leadId:70,callActivityId:8,actor:{id:9,permissions:['labels.assign','labels.remove']},addLabelIds:[2],removeLabelIds:[2],transaction:env.transaction}),error=>error.code==='LABEL_PATCH_CONFLICT');
  db.Label.findAll=async()=>[];
  await assert.rejects(service.patchAfterCall({leadId:70,callActivityId:8,actor:{id:9,permissions:['labels.assign']},addLabelIds:[999],removeLabelIds:[],transaction:env.transaction}),error=>error.code==='LABEL_NOT_FOUND');
 }finally{env.restore();}
});

test('canonical label creation requires color and rejects normalized duplicates',async()=>{
 const original=db.Label.findOne;
 try{
  await assert.rejects(labelService.create({name:'Gampaha'},{permissions:['labels.create']}),error=>error.code==='LABEL_COLOR_REQUIRED');
  db.Label.findOne=async()=>({id:4,name:'Gampaha',color:'#112233'});
  await assert.rejects(labelService.create({name:'  gampaha  ',color:'#112233'},{permissions:['labels.create']}),error=>error.status===409&&error.code==='LABEL_DUPLICATE');
 }finally{db.Label.findOne=original;}
});

test('socket failure is post-commit and cannot roll back label writes',async()=>{
 const env=environment([]);
 try{
  socket.emit=()=>{throw new Error('socket offline');};
  const result=await service.patchAfterCall({leadId:70,callActivityId:8,actor:{id:9,isSystemAdmin:true,permissions:['labels.assign']},addLabelIds:[4],removeLabelIds:[],transaction:env.transaction});
  assert.deepEqual(result.addedLabelIds,[4]);
  assert.equal(typeof env.afterCommit,'function');
  assert.doesNotThrow(()=>env.afterCommit());
 }finally{env.restore();}
});

test('Call Center outcome preselects labels and submits explicit patch semantics',()=>{
 const frontend=read('../frontend/src/pages/CallCenterPage.jsx');
 assert.match(frontend,/active\?\.lead\?\.labels/);
 assert.match(frontend,/addLabelIds/);
 assert.match(frontend,/removeLabelIds/);
 assert.match(frontend,/label="Labels"/);
});

test('Leads and Inbox subscribe to canonical label changes',()=>{
 for(const file of ['../frontend/src/pages/LeadsPage.jsx','../frontend/src/pages/ChatPage.jsx']){
  const source=read(file);
  assert.match(source,/socket\.on\('crm\.labels\.changed'/);
  assert.match(source,/socket\.off\('crm\.labels\.changed'/);
 }
});

test('canonical Leads and outcome label resolution use the same conversation precedence',()=>{
 const leads=read('src/services/lead.service.js'),labels=read('src/services/leadLabel.service.js'),callCenter=read('src/services/callCenter.service.js');
 for(const fragment of ["status IN ('open','pending')",'lead_id']){assert.ok(leads.includes(fragment));assert.ok(labels.includes(fragment));}
 assert.ok(callCenter.indexOf('synchronize_canonical_labels')<callCenter.indexOf('complete_queue_entry'));
});
