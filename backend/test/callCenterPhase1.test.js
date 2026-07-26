const test=require('node:test'),assert=require('node:assert/strict'),S=require('sequelize');
const migration=require('../migrations/048_call_center_phase1');
test('call-center phase 1 migration is additive and restart-safe',async()=>{
 const tables={lead_status:{id:{}}},indexes={};
 const q={async describeTable(t){return tables[t]||{};},async addColumn(t,c,d){(tables[t]||={})[c]=d;},async createTable(t,c){if(!tables[t])tables[t]={...c};},async addIndex(t,f,o){(indexes[t]||=[]).push({f,name:o.name});}};
 await migration.up(q,S);await migration.up(q,S);
 assert.ok(tables.lead_status.allowed_next_status_ids);assert.ok(tables.call_activities);assert.ok(tables.lead_status_history);assert.ok(tables.conversion_attributions);
 assert.equal(indexes.call_activities.filter(x=>x.name==='call_agent_started_idx').length,2);
});
test('call model distinguishes reported calls from provider-confirmed calls',()=>{
 const {CallActivity}=require('../src/models');assert.equal(CallActivity.rawAttributes.verificationSource.defaultValue,'agent_reported');
 assert.ok(CallActivity.rawAttributes.externalCallId);
});
