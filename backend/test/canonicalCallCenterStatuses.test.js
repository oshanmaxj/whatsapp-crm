const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const migration=require('../migrations/051_canonical_call_center_statuses');
test('canonical Call Center status definitions are complete and unique',()=>{
 const expected=['new','assigned','call_pending','calling','contacted','no_answer','busy','switched_off','call_rejected','wrong_number','interested','follow_up_required','not_interested','agreed','registered','lost'];
 assert.deepEqual(migration.definitions.map(row=>row[1]),expected);
 assert.equal(new Set(migration.definitions.map(row=>row[1])).size,expected.length);
});
test('migration 051 is rerunnable and never swallows database errors',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../migrations/051_canonical_call_center_statuses.js'),'utf8');
 assert.match(source,/pg_advisory_xact_lock/);
 assert.doesNotMatch(source,/\.catch\(\(\)=>\{\}\)/);
 assert.match(source,/WHERE lower\(trim\(code\)\)=:code/);
});
test('Call Center maps every configured result by canonical key and returns field errors',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/services/callCenter.service.js'),'utf8');
 for(const pair of ["busy:'busy'","no_answer:'no_answer'","call_back_later:'follow_up_required'","call_rejected:'call_rejected'","technical_failure:'call_pending'"])assert.ok(source.includes(pair));
 assert.match(source,/errors:\{newStatusId:/);
});
test('status administration is permission protected',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/routes/leadStatusAdmin.routes.js'),'utf8');
 for(const permission of ['view','create','update','disable','delete'])assert.ok(source.includes(`lead_statuses.${permission}`));
});
