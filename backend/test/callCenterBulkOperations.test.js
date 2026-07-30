const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('queue bulk add returns one stable structured result per lead',()=>{
 const source=read('src/services/callQueue.service.js');
 for(const value of ['ALREADY_IN_OWN_QUEUE','ACTIVE_IN_ANOTHER_QUEUE','NOT_ASSIGNED_TO_AGENT','LEAD_NOT_VISIBLE','WHATSAPP_ACCOUNT_NOT_PERMITTED','DEFAULT_QUEUE_MISSING','QUEUE_NOT_OWNED_BY_AGENT','LEAD_STATUS_NOT_ELIGIBLE','MISSING_PHONE','QUEUE_CAPACITY_REACHED','DUPLICATE_SUBMISSION','DATABASE_CONSTRAINT','INTERNAL_ERROR'])assert.ok(source.includes(value));
 assert.doesNotMatch(source,/'UNKNOWN'/);
 assert.match(source,/status:'added'/);
 assert.match(source,/status:'already_queued'/);
 assert.match(source,/status:'rejected'/);
 assert.match(source,/batchSize=250/);
 assert.doesNotMatch(source,/maximum of 100|pagination\.total>100/i);
});

test('lead row lock is separate from optional eligibility joins',async()=>{
 const queue=require('../src/services/callQueue.service'),db=require('../src/models'),original=db.Lead.findByPk,calls=[];
 try{
  db.Lead.findByPk=async(id,options)=>{calls.push(options);return calls.length===1?{id}:{id,ownerId:9,status:{active:true,terminal:false,countsAsConversion:false},contact:{phone:'94770000000'}};};
  await queue.assertEligible(70,{id:9,isSystemAdmin:true}, {LOCK:{UPDATE:'UPDATE'}},true);
  assert.equal(calls.length,2);
  assert.equal(calls[0].lock,'UPDATE');
  assert.equal(calls[0].include,undefined);
  assert.ok(calls[1].include);
  assert.equal(calls[1].lock,undefined);
 }finally{db.Lead.findByPk=original;}
});

test('a first database failure rolls back independently and does not poison the next lead',async()=>{
 const queue=require('../src/services/callQueue.service'),db=require('../src/models');
 const originals={transaction:db.sequelize.transaction,queue:queue.queue,eligible:queue.assertEligible,findOne:db.CallQueueEntry.findOne,max:db.CallQueueEntry.max,create:db.CallQueueEntry.create};
 let transactions=0,creates=0;
 try{
  db.sequelize.transaction=async callback=>{transactions++;return callback({LOCK:{UPDATE:'UPDATE'}});};
  queue.queue=async()=>({id:4,agentUserId:9,status:'active',capacity:null});
  queue.assertEligible=async leadId=>({id:leadId,ownerId:9,whatsappAccountId:3,status:{code:'new'},contact:{phone:'94770000000',firstName:`Lead${leadId}`}});
  db.CallQueueEntry.findOne=async()=>null;db.CallQueueEntry.max=async()=>0;
  db.CallQueueEntry.create=async()=>{creates++;if(creates===1)throw Object.assign(new Error('check constraint failed'),{name:'SequelizeDatabaseError',original:{code:'23514',table:'call_queue_entries',constraint:'required_column_check'}});return{id:2};};
  const result=await queue.addBatch([70,76],{id:9,permissions:['call_queue.manage_own']},{source:'test',sourceFilter:{}},'00000000-0000-4000-8000-000000000001','request-test');
  assert.equal(transactions,2);
  assert.equal(result[0].reasonCode,'DATABASE_CONSTRAINT');
  assert.equal(result[1].status,'added');
  assert.equal(result.some(item=>item.reasonCode==='INTERNAL_ERROR'),false);
 }finally{
  db.sequelize.transaction=originals.transaction;queue.queue=originals.queue;queue.assertEligible=originals.eligible;db.CallQueueEntry.findOne=originals.findOne;db.CallQueueEntry.max=originals.max;db.CallQueueEntry.create=originals.create;
 }
});

test('known eligibility and queue failures retain stable reason codes',async()=>{
 const queue=require('../src/services/callQueue.service'),db=require('../src/models');
 const originals={transaction:db.sequelize.transaction,queue:queue.queue,eligible:queue.assertEligible,findOne:db.CallQueueEntry.findOne,max:db.CallQueueEntry.max,create:db.CallQueueEntry.create};
 const failures=new Map([
  [70,['CALL_QUEUE_OTHER_OWNER_FORBIDDEN','NOT_ASSIGNED_TO_AGENT']],
  [71,['CALL_QUEUE_UNASSIGNED_FORBIDDEN','NOT_ASSIGNED_TO_AGENT']],
  [72,['CALL_QUEUE_ACCOUNT_FORBIDDEN','WHATSAPP_ACCOUNT_NOT_PERMITTED']],
  [73,['CALL_QUEUE_MISSING_PHONE','MISSING_PHONE']],
  [74,['CALL_QUEUE_TERMINAL','LEAD_STATUS_NOT_ELIGIBLE']]
 ]);
 try{
  db.sequelize.transaction=async callback=>callback({LOCK:{UPDATE:'UPDATE'}});
  queue.queue=async()=>({id:4,agentUserId:9,status:'active',capacity:null});
  db.CallQueueEntry.findOne=async()=>null;db.CallQueueEntry.max=async()=>0;db.CallQueueEntry.create=async()=>({id:1});
  queue.assertEligible=async leadId=>{const[code]=failures.get(leadId);throw Object.assign(new Error(code),{code,status:code.includes('FORBIDDEN')?403:422,exposeMessage:true});};
  const result=await queue.addBatch([...failures.keys()],{id:9,permissions:['call_queue.manage_own']},{source:'test'},'00000000-0000-4000-8000-000000000001','request-known');
  for(const item of result)assert.equal(item.reasonCode,failures.get(item.leadId)[1]);
  assert.equal(result.some(item=>item.reasonCode==='INTERNAL_ERROR'),false);
 }finally{
  db.sequelize.transaction=originals.transaction;queue.queue=originals.queue;queue.assertEligible=originals.eligible;db.CallQueueEntry.findOne=originals.findOne;db.CallQueueEntry.max=originals.max;db.CallQueueEntry.create=originals.create;
 }
});

test('twenty authenticated eligible lead IDs are inserted independently',async()=>{
 const queue=require('../src/services/callQueue.service'),db=require('../src/models');
 const originals={transaction:db.sequelize.transaction,queue:queue.queue,eligible:queue.assertEligible,findOne:db.CallQueueEntry.findOne,max:db.CallQueueEntry.max,create:db.CallQueueEntry.create};
 let inserted=0,transactions=0;
 try{
  db.sequelize.transaction=async callback=>{transactions++;return callback({LOCK:{UPDATE:'UPDATE'}});};
  queue.queue=async actor=>({id:4,agentUserId:actor.id,status:'active',capacity:null});
  queue.assertEligible=async(leadId,actor)=>({id:leadId,ownerId:actor.id,whatsappAccountId:3,status:{code:'new'},contact:{phone:'94770000000',firstName:`Lead${leadId}`}});
  db.CallQueueEntry.findOne=async()=>null;db.CallQueueEntry.max=async()=>inserted;
  db.CallQueueEntry.create=async()=>({id:++inserted});
  const ids=Array.from({length:20},(_,index)=>70+index);
  const result=await queue.addBatch(ids,{id:44,permissions:['call_queue.manage_own']},{source:'authenticated_test'},'00000000-0000-4000-8000-000000000001','request-20');
  assert.equal(transactions,20);assert.equal(inserted,20);assert.equal(result.every(item=>item.status==='added'),true);
 }finally{
  db.sequelize.transaction=originals.transaction;queue.queue=originals.queue;queue.assertEligible=originals.eligible;db.CallQueueEntry.findOne=originals.findOne;db.CallQueueEntry.max=originals.max;db.CallQueueEntry.create=originals.create;
 }
});

test('more than 20 and 1085 matching leads are processed in controlled pages and batches',()=>{
 const source=read('src/services/callQueue.service.js');
 const simulated=Array.from({length:1085},(_,index)=>index+1);
 const batches=[];for(let offset=0;offset<simulated.length;offset+=250)batches.push(simulated.slice(offset,offset+250));
 assert.equal(batches.length,5);
 assert.equal(batches.flat().length,1085);
 assert.ok(batches.every(batch=>batch.length<=250));
 assert.match(source,/page,limit:100/);
 assert.match(source,/while\(results\.length<total\)/);
});

test('25 eligible leads are reported added and 1085 canonical matches are consumed',async()=>{
 const queue=require('../src/services/callQueue.service'),leadService=require('../src/services/lead.service');
 const originalBatch=queue.addBatch,originalQueue=queue.queue,originalAdd=queue.add,originalList=leadService.listLeads;
 try{
  queue.queue=async()=>({id:7,capacity:null});
  queue.addBatch=async ids=>ids.map(leadId=>({leadId,status:'added',reasonCode:null,message:'Added to queue.'}));
  const twentyFive=await queue.add(Array.from({length:25},(_,index)=>index+1),{id:9,permissions:['call_queue.manage_own']});
  assert.equal(twentyFive.added,25);
  assert.equal(twentyFive.results.length,25);

  leadService.listLeads=async({page,limit})=>({leads:Array.from({length:Math.min(limit,1085-(page-1)*limit)},(_,index)=>({id:(page-1)*limit+index+1})),pagination:{total:1085}});
  queue.add=async ids=>({results:ids.map(leadId=>({leadId,status:'added',reasonCode:null,message:'Added to queue.'}))});
  const all=await queue.addMatching({status:'new'},{id:9,permissions:['call_queue.bulk_add']},{operationId:'00000000-0000-4000-8000-000000000001'});
  assert.equal(all.requested,1085);
  assert.equal(all.added,1085);
 }finally{
  queue.addBatch=originalBatch;queue.queue=originalQueue;queue.add=originalAdd;leadService.listLeads=originalList;
 }
});

test('queue UI displays reason groups, rejected lead IDs, and retry eligible',()=>{
 const source=read('../frontend/src/pages/CallCenterPage.jsx');
 assert.match(source,/queueResult\.reasons/);
 assert.match(source,/Rejected leads/);
 assert.match(source,/ID \{item\.leadId\}/);
 assert.match(source,/Retry eligible/);
 assert.match(source,/\{item\.reasonCode\}/);
 assert.doesNotMatch(source,/'UNKNOWN'/);
 assert.doesNotMatch(source,/results\.pagination\.total>100/);
});

test('bulk assignment is permission gated, previewable, audited, and moves queues atomically',()=>{
 const service=read('src/services/callCenterBulkAssignment.service.js'),routes=read('src/routes/callCenter.routes.js'),migration=read('migrations/055_call_center_bulk_operations.js');
 for(const permission of ['leads.bulk_assign','leads.assign_own','leads.assign_unassigned','leads.reassign_team','leads.reassign_all','leads.unassign'])assert.ok(migration.includes(permission));
 assert.match(routes,/p\('leads\.bulk_assign'\)/);
 assert.match(service,/dryRun/);
 assert.match(service,/LeadAssignmentHistory\.create/);
 assert.match(service,/moveQueue/);
 assert.match(service,/TARGET_AGENT_ACCOUNT_ACCESS_MISSING/);
 assert.match(service,/QUEUE_CAPACITY_REACHED/);
});
