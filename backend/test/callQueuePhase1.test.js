const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
test('queue migration is additive and protects active duplicates',()=>{
 const source=read('migrations/052_call_queue_phase1.js');
 assert.match(source,/CREATE UNIQUE INDEX call_queue_entries_active_lead_uq/);
 assert.match(source,/status IN \('pending','calling','snoozed'\)/);
 assert.match(source,/pg_advisory_xact_lock/);
 assert.doesNotMatch(source,/dropTable|TRUNCATE|DELETE FROM/i);
});
test('Call Next uses an atomic skip-locked claim and the existing Start Call transaction',()=>{
 const source=read('src/services/callQueue.service.js');
 assert.match(source,/skipLocked:true/);
 assert.match(source,/lock:transaction\.LOCK\.UPDATE/);
 assert.match(source,/callCenter\.start\(/);
 assert.match(source,/requestContext,transaction/);
});
test('queue completion is part of the Call Center outcome transaction',()=>{
 const source=read('src/services/callCenter.service.js');
 assert.match(source,/complete_queue_entry/);
 assert.match(source,/lastCallActivityId:call\.id,status:'calling'/);
});
test('Call Center search reuses the shared lead list service and server pagination',()=>{
 const source=read('src/services/callQueue.service.js');
 assert.match(source,/leadService\.listLeads\(query,actor\)/);
 const leadSource=read('src/services/lead.service.js');
 assert.match(leadSource,/safeLimit/);
 assert.match(leadSource,/neverContacted/);
 assert.match(leadSource,/noAnswerPreviously/);
});
test('conversation resolution uses explicit lead and contact relationships, never phone matching',()=>{
 const source=read('src/services/callQueue.service.js');
 assert.match(source,/\{leadId:lead\.id\}/);
 assert.match(source,/\{leadId:null,contactId:lead\.contactId\}/);
 assert.doesNotMatch(source,/normalizedPhone|phone:/);
 assert.match(source,/assertConversationAccess/);
});
test('Phase 1 queue routes enforce own and bulk permissions',()=>{
 const source=read('src/routes/callCenter.routes.js');
 for(const permission of ['call_queue.view_own','call_queue.manage_own','call_queue.bulk_add'])assert.ok(source.includes(permission));
});
