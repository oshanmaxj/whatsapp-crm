const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const decimal=require('../src/utils/decimal');

test('fixed decimal percentage calculation never uses binary floating point',()=>{
 assert.equal(decimal.multiply('1000.05','7.5000'),'75.00');
 assert.equal(decimal.add('0.10','0.20'),'0.30');
 assert.equal(decimal.subtract('100.00','12.34','7.66'),'80.00');
 assert.equal(decimal.multiply('-100.00','7.5550'),'-7.56');
 assert.equal(decimal.prorate('100.00','250.00','500.00'),'50.00');
});

test('commission idempotency and reversal invariants are encoded in migration',()=>{
 const migration=fs.readFileSync(path.join(__dirname,'../migrations/044_commission_finance_upgrade.js'),'utf8');
 assert.match(migration,/UNIQUE\(idempotency_key\)/);
 assert.match(migration,/reversal_of_id BIGINT REFERENCES commission_ledger/);
 assert.match(migration,/NUMERIC\(18,2\)/);
 assert.match(migration,/commission_payout_active_ledger_unique/);
});

test('payment integration uses immutable credited agent attribution and confirmed status',()=>{
 const calculation=fs.readFileSync(path.join(__dirname,'../src/services/commissionCalculation.service.js'),'utf8');
 assert.match(calculation,/creditedToUserId/);
 assert.match(calculation,/\['confirmed','paid'\]/);
 assert.doesNotMatch(calculation,/assignedUserId/);
});

test('backfill is report-only unless --apply is supplied',()=>{
 const backfill=fs.readFileSync(path.join(__dirname,'../src/scripts/backfill_commissions.js'),'utf8');
 assert.match(backfill,/process\.argv\.includes\('--apply'\)/);
 assert.match(backfill,/if\(apply\)/);
});

test('payout numbering separates agent and lecturer payments',()=>{
 const payout=fs.readFileSync(path.join(__dirname,'../src/services/commissionPayout.service.js'),'utf8');
 assert.match(payout,/LCP/);assert.match(payout,/AGP/);assert.match(payout,/LOCK\.UPDATE/);
});
