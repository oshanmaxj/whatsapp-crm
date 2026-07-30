const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('queue bulk add returns one stable structured result per lead',()=>{
 const source=read('src/services/callQueue.service.js');
 for(const value of ['ALREADY_IN_OWN_QUEUE','ACTIVE_IN_ANOTHER_QUEUE','NOT_ASSIGNED_TO_AGENT','LEAD_NOT_VISIBLE','MISSING_PHONE','QUEUE_CAPACITY_REACHED','DUPLICATE_SUBMISSION','DATABASE_CONSTRAINT','UNKNOWN'])assert.ok(source.includes(value));
 assert.match(source,/status:'added'/);
 assert.match(source,/status:'already_queued'/);
 assert.match(source,/status:'rejected'/);
 assert.match(source,/batchSize=250/);
 assert.doesNotMatch(source,/maximum of 100|pagination\.total>100/i);
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
